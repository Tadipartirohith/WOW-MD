import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { AgentProfile } from './entities/agent-profile.entity';
import {
  AddProfilePhotoDto,
  CreateManagedProfileDto,
  ManagedProfileSearchDto,
  UpdateManagedProfileDto,
} from './dto/managed-profile.dto';
import { AppConfigService } from '../../config/app-config.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { InvitationsService } from '../invitations/invitations.service';
import { ConsentService } from '../circulation/consent.service';
import { AgentBillingService } from './agent-billing.service';
import { ConsentScope, NetworkVisibility, ProfileLifecycle, ProfileVisibility } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { ProfileClaimStatus, UserRole } from '../../common/enums';

/**
 * Profiles built and maintained on somebody else's behalf.
 *
 * This is the "no account yet" path: an agent (or a family member looking after
 * a relative) creates a complete, matchable profile — photos, preferences,
 * contact details — for a person who has never signed up. The profile is a
 * first-class matchmaking citizen from the moment it is saved; the account only
 * appears if and when the subject accepts an invitation.
 *
 * The steward's write access ends the moment the profile is claimed. After that
 * they keep read access (it is still their client) but the owner controls the
 * content.
 */
@Injectable()
export class ManagedProfilesService {
  constructor(
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AgentProfile) private readonly agencies: Repository<AgentProfile>,
    private readonly cfg: AppConfigService,
    private readonly audit: AuditService,
    private readonly invitations: InvitationsService,
    private readonly consent: ConsentService,
    private readonly billing: AgentBillingService,
  ) {}

  /**
   * Agents must be vetted before they can create profiles or accounts for other
   * people. Without this gate anyone could self-register as an agent and start
   * minting real accounts. Family stewards are not gated: they look after a
   * couple of relatives, capped by config.
   */
  async assertMaySteward(actor: AuthUser): Promise<void> {
    if (actor.role === UserRole.ADMIN) return;
    if (actor.role !== UserRole.AGENT) return; // family: allowed, capped below

    if (!this.cfg.stewardship.requireAgentApproval) return;
    const agency = await this.agencies.findOne({ where: { ownerUserId: actor.userId } });
    if (!agency) {
      throw new ForbiddenException(
        'Register your agency details before onboarding clients (PUT /agents/agency).',
      );
    }
    if (!agency.isApproved) {
      throw new ForbiddenException(
        'Your agency is awaiting approval by an administrator. You will be emailed when it is reviewed.',
      );
    }
  }

  private quotaFor(actor: AuthUser): number {
    if (actor.role === UserRole.FAMILY) return this.cfg.stewardship.maxManagedProfilesFamily;
    return this.cfg.stewardship.maxManagedProfiles;
  }

  /**
   * Builds a profile from what a family handed over at the desk.
   *
   * Phone is the identity key here, not email: the walk-in family gives a
   * number, and a duplicate number almost always means the same person has
   * already been taken on — by this agency or another one. That is worth
   * catching, because the same biodata circulating twice from two agents is a
   * real embarrassment in this market.
   */
  async create(actor: AuthUser, dto: CreateManagedProfileDto): Promise<Profile> {
    await this.assertMaySteward(actor);

    const held = await this.profiles.count({ where: { managedByUserId: actor.userId } });
    if (held >= this.quotaFor(actor)) {
      throw new BadRequestException(
        `You have reached your limit of ${this.quotaFor(actor)} managed profiles.`,
      );
    }

    await this.assertNotDuplicate(actor, dto.contactPhone, dto.contactEmail);

    const { inviteNow, consent, ...fields } = dto;
    const profile = await this.profiles.save(
      this.profiles.create({
        ...fields,
        contactEmail: dto.contactEmail ?? null,
        userId: null,
        managedByUserId: actor.userId,
        claimStatus: ProfileClaimStatus.UNCLAIMED,
        profileCompleted: this.isComplete(fields),
      }),
    );

    // Consent is recorded with the profile, in the same request, so a profile
    // can never exist without a record of who agreed to it.
    await this.consent.record(actor, profile.id, {
      scope: ConsentScope.INTAKE,
      method: consent.method,
      givenByRelation: consent.givenByRelation,
      givenByName: consent.givenByName,
      givenByPhone: consent.givenByPhone,
      givenAt: consent.givenAt,
      notes: consent.notes,
    });
    if (consent.allowsCirculation) {
      await this.consent.record(actor, profile.id, {
        scope: ConsentScope.CIRCULATION,
        method: consent.method,
        givenByRelation: consent.givenByRelation,
        givenByName: consent.givenByName,
        givenByPhone: consent.givenByPhone,
        givenAt: consent.givenAt,
        notes: consent.notes,
      });
    }

    await this.audit.record({
      action: AuditAction.PROFILE_CREATED_BY_STEWARD,
      actor,
      resourceType: 'profile',
      resourceId: profile.id,
      metadata: { contactPhone: dto.contactPhone, hasEmail: Boolean(dto.contactEmail) },
    });

    // Taking a client on is what raises the agency's fee. It is raised, not
    // charged: nothing is collected until the client pays it, and nothing
    // reaches the agency until the match is fixed.
    if (actor.role === UserRole.AGENT) {
      await this.billing.raiseProfileFee(actor.userId, profile);
    }

    if (inviteNow) await this.invitations.invite(actor, profile.id);
    return this.findOne(actor, profile.id);
  }

  /**
   * Catches the same person being taken on twice.
   *
   * Phrasing matters: if another agency already holds them, saying so outright
   * would leak that agency's book, so the message stays neutral.
   */
  private async assertNotDuplicate(
    actor: AuthUser,
    phone: string,
    email?: string,
    excludeProfileId?: string,
  ): Promise<void> {
    if (email) {
      const existingUser = await this.users.findOne({ where: { email } });
      if (existingUser) {
        throw new ConflictException(
          'Someone already uses that email address on WOW. Send them an interest instead.',
        );
      }
    }

    const byPhone = await this.profiles.find({ where: { contactPhone: phone } });
    const clash = byPhone.find((p) => p.id !== excludeProfileId);
    if (clash) {
      throw new ConflictException(
        clash.managedByUserId === actor.userId
          ? `You already have a profile for that number: ${clash.displayName}.`
          : 'A profile already exists for that mobile number.',
      );
    }

    if (email) {
      const byEmail = await this.profiles.find({ where: { contactEmail: email } });
      if (byEmail.some((p) => p.id !== excludeProfileId)) {
        throw new ConflictException('A profile with that contact email already exists.');
      }
    }
  }

  /**
   * Loads a profile the caller stewards. Admins bypass; everyone else must be
   * the recorded steward.
   */
  async findOne(actor: AuthUser, profileId: string): Promise<Profile> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');
    if (actor.role !== UserRole.ADMIN && profile.managedByUserId !== actor.userId) {
      throw new ForbiddenException('That profile is not one you manage');
    }
    return profile;
  }

  async update(actor: AuthUser, profileId: string, dto: UpdateManagedProfileDto): Promise<Profile> {
    const profile = await this.findOne(actor, profileId);

    // Once the subject owns the profile, the steward stops being able to edit
    // it. Anything else would mean an agent could rewrite a client's live
    // profile behind their back.
    if (profile.claimStatus === ProfileClaimStatus.CLAIMED) {
      throw new ForbiddenException(
        'This profile has been claimed by its owner and can only be edited by them.',
      );
    }

    const { inviteNow, ...fields } = dto;
    void inviteNow; // only meaningful at creation

    const phoneChanged = fields.contactPhone && fields.contactPhone !== profile.contactPhone;
    const emailChanged = fields.contactEmail && fields.contactEmail !== profile.contactEmail;
    if (phoneChanged || emailChanged) {
      await this.assertNotDuplicate(
        actor,
        fields.contactPhone ?? profile.contactPhone ?? '',
        emailChanged ? fields.contactEmail : undefined,
        profile.id,
      );
    }

    Object.assign(profile, fields);
    profile.profileCompleted = this.isComplete(profile);
    return this.profiles.save(profile);
  }

  /** Photo management, kept explicit so the array cap is enforced server-side. */
  async addPhoto(actor: AuthUser, profileId: string, dto: AddProfilePhotoDto): Promise<Profile> {
    const profile = await this.findOne(actor, profileId);
    if (profile.claimStatus === ProfileClaimStatus.CLAIMED) {
      throw new ForbiddenException('This profile is owned by its subject now.');
    }
    const photos = profile.photos ?? [];
    if (photos.length >= 20) throw new BadRequestException('A profile can hold at most 20 photos.');
    if (photos.includes(dto.url)) return profile;

    profile.photos = [...photos, dto.url];
    return this.profiles.save(profile);
  }

  async removePhoto(actor: AuthUser, profileId: string, url: string): Promise<Profile> {
    const profile = await this.findOne(actor, profileId);
    if (profile.claimStatus === ProfileClaimStatus.CLAIMED) {
      throw new ForbiddenException('This profile is owned by its subject now.');
    }
    profile.photos = (profile.photos ?? []).filter((p) => p !== url);
    return this.profiles.save(profile);
  }

  async list(actor: AuthUser, q: ManagedProfileSearchDto): Promise<PaginatedResult<Profile>> {
    const qb = this.profiles
      .createQueryBuilder('p')
      .where('p."managedByUserId" = :me', { me: actor.userId });

    if (q.claimStatus) qb.andWhere('p."claimStatus" = :cs', { cs: q.claimStatus });
    if (q.q) {
      const term = `%${q.q.toLowerCase()}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('LOWER(p."displayName") LIKE :term', { term })
            .orWhere('LOWER(p."contactEmail") LIKE :term', { term })
            .orWhere('LOWER(p.city) LIKE :term', { term }),
        ),
      );
    }

    qb.orderBy('p."createdAt"', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    // Each row carries what the agency may still do to it, so the client
    // renders the same rule the server enforces.
    const withActions = data.map((profile) => ({
      ...profile,
      actions: this.agencyActions(profile),
    }));
    return paginate(withActions, total, q.page, q.limit);
  }

  /**
   * The line an agency stops at once the subject owns their profile.
   *
   * Editing was already refused, but pausing, closing and deleting were not —
   * so an agency could still take a claimed profile out of matchmaking behind
   * its owner's back. The agency keeps read access, because it is still their
   * client; what it loses is the ability to act as them.
   */
  private assertNotClaimed(profile: Profile, action: string): void {
    if (profile.claimStatus === ProfileClaimStatus.CLAIMED) {
      throw new ForbiddenException(
        `This profile belongs to its owner now — only they can ${action} it.`,
      );
    }
  }

  /**
   * Pauses a profile at the client's request.
   *
   * Nothing is deleted and nothing is refunded: a family stepping back for a
   * few months is not ending the engagement, and treating a pause as a closure
   * would cost them their place and their history.
   */
  async deactivate(actor: AuthUser, profileId: string, reason?: string): Promise<Profile> {
    const profile = await this.findOne(actor, profileId);
    this.assertNotClaimed(profile, 'pause');
    if (profile.lifecycle === ProfileLifecycle.ARCHIVED) {
      throw new BadRequestException('That profile is archived');
    }

    profile.lifecycle = ProfileLifecycle.DEACTIVATED;
    profile.deactivatedAt = new Date();
    profile.lifecycleReason = reason ?? null;
    // Pull it out of the shared pool too — a paused profile still circulating
    // is exactly what the client asked to stop.
    profile.networkVisibility = NetworkVisibility.PRIVATE;
    const saved = await this.profiles.save(profile);

    await this.audit.record({
      action: AuditAction.PROFILE_DEACTIVATED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
      metadata: { reason: reason ?? null },
    });
    return saved;
  }

  /** Brings a paused profile back. Circulation stays off until re-consented. */
  async reactivate(actor: AuthUser, profileId: string): Promise<Profile> {
    const profile = await this.findOne(actor, profileId);
    this.assertNotClaimed(profile, 'resume');
    if (profile.lifecycle === ProfileLifecycle.ARCHIVED) {
      throw new BadRequestException('An archived profile cannot be reactivated');
    }

    profile.lifecycle = ProfileLifecycle.ACTIVE;
    profile.deactivatedAt = null;
    profile.lifecycleReason = null;
    const saved = await this.profiles.save(profile);

    await this.audit.record({
      action: AuditAction.PROFILE_REACTIVATED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
    });
    return saved;
  }

  /**
   * Closes the engagement out.
   *
   * This is the soft delete: the row stays, so the consent record, the
   * circulation history and the agency's books remain answerable, but the
   * profile never matches or circulates again. Money still sitting in escrow
   * goes back — it was charged against an outcome that will not arrive.
   */
  async archive(actor: AuthUser, profileId: string, reason?: string): Promise<Profile> {
    const profile = await this.findOne(actor, profileId);
    this.assertNotClaimed(profile, 'close');

    profile.lifecycle = ProfileLifecycle.ARCHIVED;
    profile.archivedAt = new Date();
    profile.lifecycleReason = reason ?? null;
    profile.networkVisibility = NetworkVisibility.PRIVATE;
    profile.visibility = ProfileVisibility.PRIVATE;
    const saved = await this.profiles.save(profile);

    const refunded = await this.billing.refundHeldFor(profileId, reason ?? 'Profile archived');

    await this.audit.record({
      action: AuditAction.PROFILE_ARCHIVED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
      metadata: { reason: reason ?? null, chargesRefunded: refunded },
    });
    return saved;
  }

  /**
   * What an agency may still do to this profile.
   *
   * Returned alongside the profile so the client renders the same rule the
   * server enforces, rather than showing buttons that will be refused.
   */
  agencyActions(profile: Profile): {
    canEdit: boolean;
    canManagePhotos: boolean;
    canCirculate: boolean;
    canInvite: boolean;
    canPause: boolean;
    canClose: boolean;
    canDelete: boolean;
  } {
    const claimed = profile.claimStatus === ProfileClaimStatus.CLAIMED;
    const archived = profile.lifecycle === ProfileLifecycle.ARCHIVED;
    return {
      canEdit: !claimed && !archived,
      canManagePhotos: !claimed && !archived,
      canCirculate: !claimed && !archived,
      canInvite: !claimed && Boolean(profile.contactEmail),
      canPause: !claimed && !archived,
      canClose: !claimed && !archived,
      canDelete: !claimed,
    };
  }

  async remove(actor: AuthUser, profileId: string): Promise<{ success: true }> {
    const profile = await this.findOne(actor, profileId);
    if (profile.claimStatus === ProfileClaimStatus.CLAIMED) {
      throw new ForbiddenException('A claimed profile belongs to its owner and cannot be deleted here.');
    }
    await this.profiles.remove(profile);
    return { success: true };
  }

  /**
   * Every profile the caller may act under: their own, plus any they steward.
   * This is the list the "acting as" selector is built from.
   */
  async actableProfiles(actor: AuthUser): Promise<Profile[]> {
    const own = await this.profiles.find({ where: { userId: actor.userId } });
    const managed = await this.profiles.find({
      where: { managedByUserId: actor.userId },
      order: { createdAt: 'DESC' },
    });
    const seen = new Set(own.map((p) => p.id));
    return [...own, ...managed.filter((p) => !seen.has(p.id))];
  }

  private isComplete(p: Partial<Profile>): boolean {
    return Boolean(p.displayName && p.gender && p.dateOfBirth && p.city);
  }
}
