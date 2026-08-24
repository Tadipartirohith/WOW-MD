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
import { ModerationService } from '../../platform/moderation/moderation.service';
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
 * Claiming does not end the engagement. The agency keeps circulating the
 * profile, managing its photographs and running its lifecycle, because the
 * family hired them to find a match and the subject getting an account is
 * usually the point at which that work matters most. What the agency loses is
 * the biodata: two writers with no rule about who wins produces a profile that
 * contradicts itself. Delete stays available, but on a claimed profile it ends
 * the engagement rather than destroying a record its owner now depends on.
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
    private readonly moderation: ModerationService,
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

  /**
   * One profile, with what the agency may still do to it.
   *
   * The list route has carried this since the actions were introduced; opening
   * a single profile did not, so the same screen got a different answer
   * depending on how it was reached.
   */
  async findOneWithActions(actor: AuthUser, profileId: string) {
    const profile = await this.findOne(actor, profileId);
    return {
      ...profile,
      actions: this.agencyActions(profile),
      circulation: await this.consent.stateFor(profile.id),
    };
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
    // The same rule as the subject's own upload. An agency photographing a
    // walk-in client is exactly the path where a stock or generated face is
    // most tempting, and least likely to be noticed.
    await this.moderation.assertGenuinePhoto(dto.url, {
      userId: actor.userId,
      kind: 'managed_profile',
    });
    if (profile.lifecycle === ProfileLifecycle.ARCHIVED) {
      throw new ForbiddenException('This profile is closed.');
    }
    const photos = profile.photos ?? [];
    if (photos.length >= 20) throw new BadRequestException('A profile can hold at most 20 photos.');
    if (photos.includes(dto.url)) return profile;

    profile.photos = [...photos, dto.url];
    return this.profiles.save(profile);
  }

  async removePhoto(actor: AuthUser, profileId: string, url: string): Promise<Profile> {
    const profile = await this.findOne(actor, profileId);
    if (profile.lifecycle === ProfileLifecycle.ARCHIVED) {
      throw new ForbiddenException('This profile is closed.');
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

    // Whether each one may actually be circulated, in one query rather than
    // forty. Without it the client shows a Circulate button that refuses, and
    // the agent has no way of telling which profiles are ready.
    const consent = await this.consent.stateForMany(data.map((p) => p.id));

    // Each row carries what the agency may still do to it, so the client
    // renders the same rule the server enforces.
    const withActions = data.map((profile) => ({
      ...profile,
      actions: this.agencyActions(profile),
      circulation: consent.get(profile.id) ?? null,
    }));
    return paginate(withActions, total, q.page, q.limit);
  }

  /**
   * The line an agency stops at once the subject owns their profile.
   *
   * That line used to sit at the claim itself: pausing, closing, circulating
   * and photographs all stopped the moment somebody took ownership. It now
   * sits much later, because the engagement does not end when the subject gets
   * an account — the family hired the agency to find a match, and that is
   * usually the point at which the work matters most.
   *
   * Two things stay refused, for reasons that are about the data rather than
   * about the engagement. Editing the biodata, because two writers with no rule
   * about who wins produces a profile that contradicts itself. And deleting,
   * because a claimed profile *is* somebody's account profile — removing it
   * would leave a real person signed in to nothing.
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
    const archived = profile.lifecycle === ProfileLifecycle.ARCHIVED;

    // Claiming used to end every agency action. It no longer does: the family
    // engaged the agency to find a match, and the subject getting an account
    // does not end that engagement — it is usually the point at which the
    // agency's work becomes most useful. What claiming changes is that the
    // subject can now act for themselves as well.
    //
    // The one thing an agency still cannot do is edit the biodata of somebody
    // who is sitting there editing it themselves, because two writers and no
    // rule about who wins is how a profile ends up with a contradiction on it.
    const claimed = profile.claimStatus === ProfileClaimStatus.CLAIMED;

    return {
      canEdit: !claimed && !archived,
      canManagePhotos: !archived,
      canCirculate: !archived,
      canInvite: !claimed && Boolean(profile.contactEmail),
      canPause: !archived,
      canClose: !archived,
      // Available after a claim too, but it means something different there:
      // ending the engagement rather than destroying somebody's account
      // profile. `remove()` carries that distinction, and says which happened.
      canDelete: true,
    };
  }

  /**
   * Take a profile off the agency's book.
   *
   * What that means depends on who owns the record, and the difference is not
   * cosmetic.
   *
   * An **unclaimed** profile exists only because the agency wrote it up. There
   * is no account behind it and nobody else has a claim on it, so deleting
   * removes it.
   *
   * A **claimed** profile is somebody's own. The specification asks for delete
   * to remain available after a claim, and it now is — but destroying the row
   * would take a real person's biodata, consents and matchmaking history with
   * it and leave them signed in to nothing. So for a claimed profile this ends
   * the *engagement*: the profile leaves the agency's book and the owner keeps
   * everything. That is what the button means to an agent either way — "get
   * this off my list" — and it is the only reading where it cannot destroy an
   * account that is not theirs.
   *
   * The consent record and the agency's own billing history survive both paths.
   * They are what the platform answers for its own conduct with, and an agency
   * closing a file is not a reason to lose them.
   */
  async remove(
    actor: AuthUser,
    profileId: string,
  ): Promise<{ success: true; released: boolean; message: string }> {
    const profile = await this.findOne(actor, profileId);
    const claimed = profile.claimStatus === ProfileClaimStatus.CLAIMED;

    if (claimed) {
      profile.managedByUserId = null;
      // Circulation runs on the agency's consent record and their reach. With
      // the engagement over, neither applies, so the profile goes back to
      // private rather than staying in a pool it was put into on the agency's
      // account.
      profile.networkVisibility = NetworkVisibility.PRIVATE;
      await this.profiles.save(profile);

      await this.audit.record({
        action: AuditAction.PROFILE_ARCHIVED,
        actor,
        resourceType: 'profile',
        resourceId: profileId,
        metadata: { released: true, ownerUserId: profile.userId },
      });

      return {
        success: true,
        released: true,
        message:
          'Removed from your book. The profile belongs to its owner, so their details and ' +
          'history stay with them.',
      };
    }

    await this.profiles.remove(profile);
    await this.audit.record({
      action: AuditAction.PROFILE_ARCHIVED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
      metadata: { released: false, deleted: true },
    });

    return {
      success: true,
      released: false,
      message: 'Deleted. Nobody had claimed this profile, so nothing of theirs was attached to it.',
    };
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
