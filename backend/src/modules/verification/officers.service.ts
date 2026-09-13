import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { CreateOfficerDto, SetAvailabilityDto } from './dto/officer.dto';
import {
  AvailabilityView,
  OfficerAvailability,
  availabilityView,
  todayIso,
} from './entities/officer-availability.entity';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../platform/mail/mail.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { generateTemporaryPassword } from '../../common/util/passwords';
import { OfficerAvailabilityStatus, ProfileClaimStatus, UserRole } from '../../common/enums';

export interface OfficerView {
  id: string;
  email: string | null;
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
  /**
   * Whether the officer is taking new fieldwork. Exposed on the roster so the
   * admin console can show it and auto-allocation can skip anyone on leave —
   * `onLeaveNow` is the flag that decides the latter.
   */
  availability: AvailabilityView;
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
    @InjectRepository(OfficerAvailability)
    private readonly availability: Repository<OfficerAvailability>,
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
    // One account per number, as registration requires (EZ1-I258).
    if (dto.phone) {
      const numberTaken = await this.users.findOne({ where: { phone: dto.phone } });
      if (numberTaken) throw new ConflictException('That mobile number already has an account');
    }

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

    // One read for every officer's availability, mapped by id — the roster is
    // where the admin console reads on-leave from (EZ1-I212).
    const avail = await this.availability.find({
      where: people.map((o) => ({ officerUserId: o.id })),
    });
    const availByUser = new Map(avail.map((a) => [a.officerUserId, a]));

    return people.map((o) =>
      this.view(o, byUser.get(o.id) ?? o.email ?? o.phone ?? o.id, availByUser.get(o.id)),
    );
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
    const availability = await this.availability.findOne({ where: { officerUserId: officerId } });
    return this.view(officer, profile?.displayName ?? officer.email ?? officer.id, availability);
  }

  private view(user: User, name: string, availability?: OfficerAvailability | null): OfficerView {
    return {
      id: user.id,
      email: user.email,
      name,
      phone: user.phone ?? null,
      isActive: user.isActive,
      createdAt: user.createdAt,
      kind: user.role === UserRole.AGENT ? 'agent' : 'officer',
      availability: availabilityView(availability),
    };
  }

  // -------------------------------------------------------------- availability

  /**
   * An officer's own availability. Returns the AVAILABLE default rather than
   * nothing when they have never set it, so the portal always has a state to
   * show and the admin roster always has one to read.
   */
  async getAvailability(officerUserId: string): Promise<AvailabilityView> {
    const row = await this.availability.findOne({ where: { officerUserId } });
    return availabilityView(row);
  }

  /**
   * An officer setting their own availability.
   *
   * The leave window is two dates or neither, and the end may not precede the
   * start — a half-set window would leave the allocator guessing. Any status
   * other than ON_LEAVE clears the window, so a stale one never reads as live.
   *
   * Leave is booked, not recorded: a window that starts before today cannot
   * change what was allocated while it was not there, so it is refused
   * (EZ1-I256). The portal and the app disable those dates in the picker; this
   * is what stops a request that never went near a picker.
   *
   * The one exception is the start date already on the row. An officer who has
   * been on leave since last week and comes back to correct the reason, or to
   * extend the end, is not setting a past date — and refusing them would make
   * their own existing record unsaveable, which the ticket rules out.
   */
  async setAvailability(
    actor: AuthUser,
    dto: SetAvailabilityDto,
  ): Promise<AvailabilityView> {
    const onLeave = dto.status === OfficerAvailabilityStatus.ON_LEAVE;

    const row =
      (await this.availability.findOne({ where: { officerUserId: actor.userId } })) ??
      this.availability.create({ officerUserId: actor.userId });

    if (onLeave) {
      if (!dto.leaveFrom || !dto.leaveTo) {
        throw new BadRequestException('On leave needs a start and an end date');
      }
      if (dto.leaveTo < dto.leaveFrom) {
        throw new BadRequestException('Leave end date cannot be before the start date');
      }
      if (dto.leaveFrom < todayIso() && dto.leaveFrom !== row.leaveFrom) {
        throw new BadRequestException('Leave cannot start before today');
      }
      // A kept start date may be in the past; a window that has already ended
      // may not be booked (EZ1-I256).
      if (dto.leaveTo < todayIso()) {
        throw new BadRequestException('Leave cannot end before today');
      }
    }

    row.status = dto.status;
    row.leaveFrom = onLeave ? (dto.leaveFrom as string) : null;
    row.leaveTo = onLeave ? (dto.leaveTo as string) : null;
    // A reason is only meaningful while on leave; drop it otherwise.
    row.leaveReason = onLeave ? dto.leaveReason?.trim() || null : null;

    const saved = await this.availability.save(row);
    return availabilityView(saved);
  }
}
