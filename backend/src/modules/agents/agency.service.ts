import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
import { generateToken } from '../../common/util/tokens';
import { AppConfigService } from '../../config/app-config.service';

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
    // For the one runtime setting every link the platform hands out is built
    // from (EZ1-I178).
    private readonly cfg: AppConfigService,
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
    } else {
      // A rejected agency cannot edit-and-resubmit its way back into review
      // (EZ1-I66, EZ1-I72). Checked before any mutation so a refused resubmit
      // does not wipe the rejection reason or the saved details.
      await this.verification.assertNotRejected(ownerUserId, agency.id);
    }
    Object.assign(agency, dto);
    agency.rejectionReason = null;
    const saved = await this.agencies.save(agency);

    // Submitting details is what puts an agency in the field-verification
    // queue. Nobody approves an agency from a form alone: an officer visits the
    // address on it, and their decision is what flips `isApproved`. The call is
    // idempotent, so editing details while a visit is pending does not queue a
    // second one.
    await this.verification.raise(ApplicantType.AGENT, ownerUserId, saved.id, saved.agencyName);
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

  /**
   * Mints (or rotates) the agency's standing client sign-up link (EZ1-I166).
   *
   * The token is returned exactly once — it is stored hashed, so it can never
   * be shown again — and re-minting invalidates the previous one, which is how
   * a link that spread further than intended is withdrawn. Gated on approval:
   * an unapproved agency cannot build profiles or invite, and must not be able
   * to onboard accounts through a link either.
   */
  async createShareLink(ownerUserId: string): Promise<{ token: string; url: string }> {
    const agency = await this.assertApprovedAgency(ownerUserId);
    const { token, tokenHash } = generateToken();
    agency.shareTokenHash = tokenHash;
    agency.shareTokenCreatedAt = new Date();
    await this.agencies.save(agency);
    /*
     * The whole address, built here rather than in the browser (EZ1-I178).
     *
     * The page pasted the token onto `window.location.origin`, so the agent was
     * handed a link to whatever address they happened to have the portal open
     * on — `localhost:8080` on a dev machine, an internal hostname behind a
     * proxy — and sent it to a client who could not open it. APP_BASE_URL is
     * the runtime setting every other link on this platform is built from, and
     * `/join/:token` is the route the portal serves this one at.
     */
    const base = this.cfg.mail.appBaseUrl.replace(/\/+$/, '');
    return { token, url: `${base}/join/${token}` };
  }

  /** Stops the link working, without touching the clients who already used it. */
  async revokeShareLink(ownerUserId: string): Promise<{ success: true }> {
    const agency = await this.getOwn(ownerUserId);
    agency.shareTokenHash = null;
    agency.shareTokenCreatedAt = null;
    await this.agencies.save(agency);
    return { success: true };
  }

  private async assertApprovedAgency(ownerUserId: string): Promise<AgentProfile> {
    const agency = await this.getOwn(ownerUserId);
    if (!agency.isApproved) {
      throw new ForbiddenException(
        'Your agency is awaiting approval by an administrator before you can onboard clients.',
      );
    }
    return agency;
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
    // An agency registers with an address, so this is defence rather than a
    // real case -- but email is optional on an account now (EZ1-I233).
    if (owner?.email) {
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
    if (owner?.email) {
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
