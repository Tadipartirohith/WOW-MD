import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentProfile } from './entities/agent-profile.entity';
import { User } from '../auth/entities/user.entity';
import { UpsertAgencyDto } from './dto/agency.dto';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { MailService } from '../../platform/mail/mail.service';
import { VerificationService } from '../verification/verification.service';
import { ApplicantType } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/**
 * The agency registration record that gates an agent's ability to act for
 * other people.
 *
 * An agent can sign in and browse the moment they register, but every
 * stewardship path (build a profile, invite, onboard a client) checks that this
 * record exists and has been approved. That closes the hole where anyone could
 * self-register as an agent and immediately start creating real accounts for
 * third parties.
 */
@Injectable()
export class AgencyService {
  constructor(
    @InjectRepository(AgentProfile) private readonly agencies: Repository<AgentProfile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly verification: VerificationService,
  ) {}

  async upsertOwn(ownerUserId: string, dto: UpsertAgencyDto): Promise<AgentProfile> {
    let agency = await this.agencies.findOne({ where: { ownerUserId } });
    if (!agency) {
      agency = this.agencies.create({ ownerUserId, isApproved: false });
    } else if (agency.isApproved) {
      // Editing the details of an approved agency does not re-open review; only
      // the name and contact information can drift, and admins can suspend.
      Object.assign(agency, dto);
      return this.agencies.save(agency);
    }
    Object.assign(agency, dto);
    agency.rejectionReason = null;
    const saved = await this.agencies.save(agency);

    // Submitting details is what puts an agency in the field-verification
    // queue. Nobody approves an agency from a form alone: an officer visits the
    // address on it, and their decision is what flips `isApproved`. The call is
    // idempotent, so editing details while a visit is pending does not queue a
    // second one.
    await this.verification.raise(ApplicantType.AGENT, ownerUserId, saved.id);
    return saved;
  }

  async getOwn(ownerUserId: string): Promise<AgentProfile> {
    const agency = await this.agencies.findOne({ where: { ownerUserId } });
    if (!agency) {
      throw new NotFoundException('You have not registered your agency details yet');
    }
    return agency;
  }

  /** Null rather than throwing, for status banners on the client. */
  async findOwn(ownerUserId: string): Promise<AgentProfile | null> {
    return this.agencies.findOne({ where: { ownerUserId } });
  }

  listPending(): Promise<AgentProfile[]> {
    return this.agencies.find({ where: { isApproved: false }, order: { createdAt: 'ASC' } });
  }

  async approve(actor: AuthUser, agencyId: string): Promise<AgentProfile> {
    const agency = await this.agencies.findOne({ where: { id: agencyId } });
    if (!agency) throw new NotFoundException('Agency not found');

    agency.isApproved = true;
    agency.approvedAt = new Date();
    agency.approvedByUserId = actor.userId;
    agency.rejectionReason = null;
    const saved = await this.agencies.save(agency);

    await this.audit.record({
      action: AuditAction.AGENT_APPROVED,
      actor,
      resourceType: 'agent_profile',
      resourceId: agency.id,
      metadata: { ownerUserId: agency.ownerUserId },
    });

    const owner = await this.users.findOne({ where: { id: agency.ownerUserId } });
    if (owner) {
      await this.mail.sendAgentApprovalResult({
        to: owner.email,
        agencyName: agency.agencyName,
        approved: true,
      });
    }
    return saved;
  }

  async reject(actor: AuthUser, agencyId: string, reason: string): Promise<AgentProfile> {
    const agency = await this.agencies.findOne({ where: { id: agencyId } });
    if (!agency) throw new NotFoundException('Agency not found');

    agency.isApproved = false;
    agency.rejectionReason = reason;
    const saved = await this.agencies.save(agency);

    await this.audit.record({
      action: AuditAction.AGENT_REJECTED,
      actor,
      resourceType: 'agent_profile',
      resourceId: agency.id,
      metadata: { reason },
    });

    const owner = await this.users.findOne({ where: { id: agency.ownerUserId } });
    if (owner) {
      await this.mail.sendAgentApprovalResult({
        to: owner.email,
        agencyName: agency.agencyName,
        approved: false,
        reason,
      });
    }
    return saved;
  }
}
