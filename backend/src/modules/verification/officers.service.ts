import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { CreateOfficerDto } from './dto/officer.dto';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../platform/mail/mail.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { generateTemporaryPassword } from '../../common/util/passwords';
import { ProfileClaimStatus, UserRole } from '../../common/enums';

export interface OfficerView {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  /**
   * Staff, or an agency being used as one.
   *
   * The allocator shows the two apart rather than in one undifferentiated
   * list, because sending a commercial participant to inspect a business is a
   * different decision from sending an officer, and an administrator should
   * be able to see which one they are making.
   */
  kind: 'officer' | 'agent';
}

/**
 * In-Person Verification accounts.
 *
 * These are staff, not customers: there is no sign-up path for them and never
 * should be, because an officer decides whether other people get operational
 * access. An administrator creates the account and the credentials go out by
 * email under the same single-use rule as a provisioned customer.
 */
@Injectable()
export class OfficersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly cfg: AppConfigService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: AuthUser,
    dto: CreateOfficerDto,
  ): Promise<OfficerView & { temporaryPasswordSent: boolean; devPassword?: string }> {
    const exists = await this.users.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException('That email already has an account');

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, this.cfg.auth.bcryptRounds);

    const officer = await this.users.save(
      this.users.create({
        email: dto.email,
        phone: dto.phone ?? null,
        passwordHash,
        role: UserRole.IN_PERSON,
        isActive: true,
        // Staff accounts are created by an administrator who already knows who
        // this is, so the address needs no separate proof.
        isVerified: true,
        mustResetPassword: true,
        isProvisioned: true,
      }),
    );

    // The profile row is what carries the officer's name through the rest of
    // the app: queues, allocation lists and case history all read it.
    await this.profiles.save(
      this.profiles.create({
        userId: officer.id,
        displayName: dto.name,
        contactEmail: dto.email,
        contactPhone: dto.phone ?? null,
        claimStatus: ProfileClaimStatus.SELF,
        profileCompleted: true,
      }),
    );

    await this.mail.sendProvisionedCredentials({
      to: dto.email,
      name: dto.name,
      temporaryPassword,
    });

    await this.audit.record({
      action: AuditAction.OFFICER_CREATED,
      actor,
      resourceType: 'user',
      resourceId: officer.id,
      metadata: { email: dto.email, region: dto.region ?? null },
    });

    // The 'log' mail provider does not deliver anything, so in that mode the
    // credential would be unreachable and the account unusable. Hand it back on
    // the response instead — and ONLY in that mode, the same rule invitations
    // follow, because this password is a working credential for a staff
    // account that decides who else gets access.
    const dev = this.cfg.mail.provider === 'log' ? { devPassword: temporaryPassword } : {};

    return { ...this.view(officer, dto.name), temporaryPasswordSent: true, ...dev };
  }

  /**
   * Everybody an administrator may allocate fieldwork to.
   *
   * Officers and agents, because an agent holds VERIFICATION_FIELDWORK too and
   * a list that omitted them would offer half the people who can do the job.
   * Whether a particular agent may take a particular request is not a question
   * this list can answer — it depends on who introduced the applicant — so the
   * allocator decides that and this stays a roster.
   */
  async list(): Promise<OfficerView[]> {
    // Verification officers only. Agents used to appear here because they could
    // be sent on field visits, but verification is now an internal-officer
    // function (EZ1-I20/I22): a commercial agent must not show up in the admin's
    // "allocate to" roster, where the admin might hand them a competitor's or
    // their own client's application.
    const people = await this.users.find({
      where: { role: UserRole.IN_PERSON },
      select: ['id', 'email', 'phone', 'isActive', 'createdAt', 'role'],
      order: { createdAt: 'ASC' },
    });
    if (people.length === 0) return [];

    const names = await this.profiles.find({
      where: people.map((o) => ({ userId: o.id })),
      select: ['userId', 'displayName'],
    });
    const byUser = new Map(names.map((p) => [p.userId as string, p.displayName]));
    return people.map((o) => this.view(o, byUser.get(o.id) ?? o.email));
  }

  /**
   * Suspending an officer, rather than deleting them. Their decisions and case
   * history stay attributable — that is the whole point of an audit trail.
   */
  async setActive(actor: AuthUser, officerId: string, isActive: boolean): Promise<OfficerView> {
    const officer = await this.users.findOne({ where: { id: officerId } });
    if (!officer) throw new NotFoundException('Verification officer not found');
    if (officer.role !== UserRole.IN_PERSON) {
      throw new BadRequestException('That account is not a verification officer');
    }

    officer.isActive = isActive;
    await this.users.save(officer);
    await this.audit.record({
      action: AuditAction.OFFICER_CREATED,
      actor,
      resourceType: 'user',
      resourceId: officerId,
      metadata: { isActive },
    });

    const profile = await this.profiles.findOne({ where: { userId: officerId } });
    return this.view(officer, profile?.displayName ?? officer.email);
  }

  private view(user: User, name: string): OfficerView {
    return {
      id: user.id,
      email: user.email,
      name,
      phone: user.phone ?? null,
      isActive: user.isActive,
      createdAt: user.createdAt,
      kind: user.role === UserRole.AGENT ? 'agent' : 'officer',
    };
  }
}
