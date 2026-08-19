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

  async create(actor: AuthUser, dto: CreateManagedProfileDto): Promise<Profile> {
    await this.assertMaySteward(actor);

    const held = await this.profiles.count({ where: { managedByUserId: actor.userId } });
    if (held >= this.quotaFor(actor)) {
      throw new BadRequestException(
        `You have reached your limit of ${this.quotaFor(actor)} managed profiles.`,
      );
    }

    // Refuse if that person already has an account: they should be approached,
    // not duplicated.
    const existingUser = await this.users.findOne({ where: { email: dto.contactEmail } });
    if (existingUser) {
      throw new ConflictException(
        'Someone already uses that email address on WOW. Send them an interest instead.',
      );
    }
    const existingProfile = await this.profiles.findOne({
      where: { contactEmail: dto.contactEmail },
    });
    if (existingProfile) {
      throw new ConflictException('A profile with that contact email already exists.');
    }

    const { inviteNow, ...fields } = dto;
    const profile = await this.profiles.save(
      this.profiles.create({
        ...fields,
        userId: null,
        managedByUserId: actor.userId,
        claimStatus: ProfileClaimStatus.UNCLAIMED,
        profileCompleted: this.isComplete(fields),
      }),
    );

    await this.audit.record({
      action: AuditAction.PROFILE_CREATED_BY_STEWARD,
      actor,
      resourceType: 'profile',
      resourceId: profile.id,
      metadata: { contactEmail: dto.contactEmail },
    });

    if (inviteNow) await this.invitations.invite(actor, profile.id);
    return this.findOne(actor, profile.id);
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

    if (fields.contactEmail && fields.contactEmail !== profile.contactEmail) {
      const clash = await this.users.findOne({ where: { email: fields.contactEmail } });
      if (clash) throw new ConflictException('Someone already uses that email address on WOW.');
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
    return paginate(data, total, q.page, q.limit);
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
