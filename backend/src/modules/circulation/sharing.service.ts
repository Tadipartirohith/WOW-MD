import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, IsNull, Repository } from 'typeorm';
import { ProfileShare } from './entities/profile-share.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { ConsentService } from './consent.service';
import {
  PoolSearchDto,
  ShareToAgentDto,
  ShareToUserDto,
  ShareLinkDto,
  SetPoolVisibilityDto,
} from './dto/sharing.dto';
import { AppConfigService } from '../../config/app-config.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { expiresIn, generateToken, hashToken } from '../../common/util/tokens';
import {
  NetworkVisibility,
  ProfileVisibility,
  InterestStatus,
  ShareAudience,
  UserRole,
  isIndividual,
} from '../../common/enums';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { ProfileDetailsService } from '../profile-details/profile-details.service';

export interface ShareResult {
  share: ProfileShare;
  /** Only populated for LINK shares, and only on creation. */
  url?: string;
}

/**
 * Circulation: getting a profile in front of people who might have a match.
 *
 * This is the agent's actual job, and it happens five ways:
 *
 *  1. to another agent, who can propose from their own book
 *  2. into the vetted-agent pool, searchable by every approved agency
 *  3. as a signed link, for a family with no account (the WhatsApp biodata)
 *  4. directly to a platform user who does have an account
 *  5. as a printable biodata sheet, which is the link rendered for paper
 *
 * Every one of them checks circulation consent first, and every one produces a
 * revocable record — the agency has to be able to answer "who has seen my
 * client's details?" and to take it back.
 *
 * A share grants READ ONLY. It never lets the recipient edit the profile or act
 * as it; that stays with the owner and the steward.
 */
/** Who circulated a profile, as the receiving agent needs to see it. */
export interface SharerView {
  agencyName: string | null;
  city: string | null;
  contactPhone: string | null;
  email: string | null;
}

@Injectable()
export class SharingService {
  constructor(
    @InjectRepository(ProfileShare) private readonly shares: Repository<ProfileShare>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AgentProfile) private readonly agencies: Repository<AgentProfile>,
    private readonly consent: ConsentService,
    private readonly details: ProfileDetailsService,
    private readonly cfg: AppConfigService,
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------- guard rails

  /** The profile must be one the caller controls, and cleared for circulation. */
  private async circulatable(actor: AuthUser, profileId: string): Promise<Profile> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');

    const owns = profile.userId !== null && profile.userId === actor.userId;
    const stewards = profile.managedByUserId === actor.userId;
    if (!owns && !stewards && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('That profile is not yours to circulate');
    }
    if (profile.visibility === ProfileVisibility.PRIVATE) {
      throw new BadRequestException(
        'This profile is marked private. Change its visibility before circulating it.',
      );
    }

    await this.consent.assertMayCirculate(profile);
    await this.assertBiodataComplete(profile);
    return profile;
  }

  /**
   * A half-filled biodata is not ready to send to another family.
   *
   * The first thing the other side does with it is ask about the family, the
   * education and the horoscope — and an agent circulating a profile with those
   * blank has nothing to answer with. The refusal names what is missing, so the
   * fix is a specific piece of work rather than a hunt.
   *
   * Identity verification is excluded on purpose: it runs on its own track and
   * should never hold up an introduction.
   */
  private async assertBiodataComplete(profile: Profile): Promise<void> {
    if (await this.details.isBiodataComplete(profile.id)) return;

    const missing = await this.details.missingSections(profile.id);
    throw new BadRequestException(
      missing.length
        ? `This biodata is not complete enough to circulate. Still needed: ${missing.join(', ')}.`
        : 'This biodata is not complete enough to circulate.',
    );
  }

  private async assertApprovedAgent(userId: string): Promise<void> {
    const agency = await this.agencies.findOne({ where: { ownerUserId: userId } });
    if (!agency?.isApproved) {
      throw new BadRequestException('That agent is not approved on the platform');
    }
  }

  // --------------------------------------------------------- 1. to an agent

  async shareWithAgent(actor: AuthUser, dto: ShareToAgentDto): Promise<ShareResult> {
    const profile = await this.circulatable(actor, dto.profileId);
    if (dto.agentUserId === actor.userId) {
      throw new BadRequestException('You already hold this profile');
    }

    const recipient = await this.users.findOne({ where: { id: dto.agentUserId } });
    if (!recipient || !recipient.isActive) throw new NotFoundException('Agent not found');
    if (recipient.role !== UserRole.AGENT) {
      throw new BadRequestException('That account is not an agent');
    }
    await this.assertApprovedAgent(recipient.id);

    return { share: await this.upsertDirectShare(actor, profile, ShareAudience.AGENT, recipient.id, dto.message) };
  }

  // ---------------------------------------------------------- 2. to a user

  /**
   * Straight to a platform user who already has an account — the family that
   * signed up themselves and is browsing on their own. They see the profile in
   * their shared-with-me list without the agent needing a matching profile at
   * their end.
   */
  async shareWithUser(actor: AuthUser, dto: ShareToUserDto): Promise<ShareResult> {
    const profile = await this.circulatable(actor, dto.profileId);
    if (dto.userId === actor.userId) {
      throw new BadRequestException('You already hold this profile');
    }
    if (profile.userId === dto.userId) {
      throw new BadRequestException('That is this profile’s own account');
    }

    const recipient = await this.users.findOne({ where: { id: dto.userId } });
    if (!recipient || !recipient.isActive) throw new NotFoundException('User not found');
    if (!isIndividual(recipient.role) && recipient.role !== UserRole.AGENT) {
      throw new BadRequestException(
        'Profiles can only be shared with individual accounts or agents',
      );
    }

    return { share: await this.upsertDirectShare(actor, profile, ShareAudience.USER, recipient.id, dto.message) };
  }

  /** One live share per (profile, recipient): re-sharing refreshes it. */
  private async upsertDirectShare(
    actor: AuthUser,
    profile: Profile,
    audience: ShareAudience,
    recipientUserId: string,
    message?: string,
  ): Promise<ProfileShare> {
    const existing = await this.shares.findOne({
      where: { profileId: profile.id, recipientUserId, revokedAt: IsNull() },
    });

    const share = existing ?? this.shares.create({ profileId: profile.id, recipientUserId });
    share.sharedByUserId = actor.userId;
    share.audience = audience;
    share.message = message ?? share.message ?? null;
    share.expiresAt = null;
    const saved = await this.shares.save(share);

    await this.audit.record({
      action: AuditAction.PROFILE_SHARED,
      actor,
      resourceType: 'profile',
      resourceId: profile.id,
      metadata: { audience, recipientUserId },
    });
    return saved;
  }

  // ------------------------------------------------------------ 3. as a link

  /**
   * A signed link for someone with no account: the digital biodata sheet that
   * gets forwarded on WhatsApp. Only the hash is stored, so a database leak
   * yields no working links, and it expires by default.
   */
  async createShareLink(actor: AuthUser, dto: ShareLinkDto): Promise<ShareResult> {
    const profile = await this.circulatable(actor, dto.profileId);

    const { token, tokenHash } = generateToken();
    const days = dto.expiresInDays ?? this.cfg.stewardship.shareLinkTtlDays;
    const share = await this.shares.save(
      this.shares.create({
        profileId: profile.id,
        sharedByUserId: actor.userId,
        audience: ShareAudience.LINK,
        recipientUserId: null,
        tokenHash,
        message: dto.message ?? null,
        expiresAt: expiresIn(days * 86_400),
      }),
    );

    await this.audit.record({
      action: AuditAction.PROFILE_SHARED,
      actor,
      resourceType: 'profile',
      resourceId: profile.id,
      metadata: { audience: ShareAudience.LINK, expiresInDays: days },
    });

    const base = this.cfg.mail.appBaseUrl.replace(/\/+$/, '');
    return { share, url: `${base}/biodata/${token}` };
  }

  /**
   * Public resolution of a share link. Bumps the view counter so the agency can
   * see whether the biodata was actually opened.
   */
  async resolveLink(token: string): Promise<Profile> {
    const share = await this.shares.findOne({
      where: { tokenHash: hashToken(token), revokedAt: IsNull() },
    });
    if (!share) throw new NotFoundException('That link is not valid or has been withdrawn');
    if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('That link has expired. Ask the agent for a new one.');
    }

    const profile = await this.profiles.findOne({ where: { id: share.profileId } });
    if (!profile) throw new NotFoundException('That profile is no longer available');

    // Consent can be withdrawn after the link went out; honour that on read.
    await this.consent.assertMayCirculate(profile);

    await this.shares.update(share.id, {
      viewCount: share.viewCount + 1,
      lastViewedAt: new Date(),
    });
    return profile;
  }

  // ------------------------------------------------------------- 4. the pool

  async setPoolVisibility(
    actor: AuthUser,
    profileId: string,
    dto: SetPoolVisibilityDto,
  ): Promise<Profile> {
    // Entering the pool is circulation; leaving it never needs permission.
    const profile =
      dto.visibility === NetworkVisibility.POOL
        ? await this.circulatable(actor, profileId)
        : await this.controlled(actor, profileId);

    if (dto.visibility === NetworkVisibility.POOL) {
      await this.assertPoolQuota(actor, profileId);
    }

    profile.networkVisibility = dto.visibility;
    profile.pooledAt = dto.visibility === NetworkVisibility.POOL ? new Date() : null;
    const saved = await this.profiles.save(profile);

    await this.audit.record({
      action:
        dto.visibility === NetworkVisibility.POOL
          ? AuditAction.PROFILE_POOLED
          : AuditAction.PROFILE_UNPOOLED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
    });
    return saved;
  }

  /**
   * A ceiling on how much of the pool any one agency can be.
   *
   * The pool is a shared resource: every approved agency browses it, and
   * nothing stopped one from putting its entire book into it and drowning
   * everybody else's. A quota is a blunt instrument, but the alternative — a
   * quality score — is a judgement the platform is not in a position to make
   * about somebody else's clients.
   *
   * Admins are exempt, because an admin re-listing during a support call is not
   * the behaviour this guards against.
   */
  private async assertPoolQuota(actor: AuthUser, profileId: string): Promise<void> {
    if (actor.role === UserRole.ADMIN) return;

    const already = await this.profiles.count({
      where: {
        managedByUserId: actor.userId,
        networkVisibility: NetworkVisibility.POOL,
      },
    });
    // Re-pooling something already in the pool is a no-op, not a new entry.
    const current = await this.profiles.findOne({ where: { id: profileId } });
    if (current?.networkVisibility === NetworkVisibility.POOL) return;

    const limit = this.cfg.matchmaking.poolQuotaPerAgency;
    if (already >= limit) {
      throw new BadRequestException(
        `You have ${already} profiles in the network pool, which is the limit of ${limit}. ` +
          `Take one out before adding another.`,
      );
    }
  }

  /**
   * Did circulating this profile lead anywhere?
   *
   * An agency could already see who held a profile and whether a link had been
   * opened, but not whether any of it produced anything — which is the only
   * question an agent actually has about their own circulation. Opened-but-
   * silent is the interesting number here: it means the biodata is reaching
   * people and being passed over, which is a different problem from nobody
   * looking at it.
   */
  async reach(actor: AuthUser, profileId: string) {
    const profile = await this.controlled(actor, profileId);

    const shares = await this.shares.find({ where: { profileId: profile.id } });
    const live = shares.filter((share) => !share.revokedAt);
    const opened = live.filter((share) => share.viewCount > 0);

    // An interest in either direction with somebody the profile was shared to
    // is the outcome circulation exists to produce.
    const interests = await this.interests.find({
      where: [{ fromProfileId: profile.id }, { toProfileId: profile.id }],
    });
    const accepted = interests.filter((i) => i.status === InterestStatus.ACCEPTED);

    return {
      profileId: profile.id,
      shared: shares.length,
      live: live.length,
      revoked: shares.length - live.length,
      opened: opened.length,
      totalViews: live.reduce((sum, share) => sum + share.viewCount, 0),
      /** Reached somebody who then never came back. The number worth acting on. */
      openedButSilent: Math.max(0, opened.length - interests.length),
      interests: interests.length,
      accepted: accepted.length,
      byAudience: Object.fromEntries(
        Object.values(ShareAudience).map((audience) => [
          audience,
          live.filter((share) => share.audience === audience).length,
        ]),
      ),
    };
  }

  private async controlled(actor: AuthUser, profileId: string): Promise<Profile> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');
    const owns = profile.userId !== null && profile.userId === actor.userId;
    const stewards = profile.managedByUserId === actor.userId;
    if (!owns && !stewards && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('That profile is not yours');
    }
    return profile;
  }

  /**
   * The vetted-agent pool. Only approved agents may search it, and an agent
   * never sees their own listings here — those live in their own book.
   */
  async searchPool(actor: AuthUser, q: PoolSearchDto): Promise<PaginatedResult<Profile>> {
    if (actor.role !== UserRole.ADMIN) await this.assertApprovedAgent(actor.userId);

    const qb = this.profiles
      .createQueryBuilder('p')
      .where('p."networkVisibility" = :pool', { pool: NetworkVisibility.POOL })
      .andWhere('p.visibility != :private', { private: ProfileVisibility.PRIVATE })
      .andWhere('(p."managedByUserId" IS NULL OR p."managedByUserId" != :me)', { me: actor.userId });

    if (q.gender) qb.andWhere('LOWER(p.gender) = LOWER(:gender)', { gender: q.gender });
    if (q.city) qb.andWhere('LOWER(p.city) = LOWER(:city)', { city: q.city });
    if (q.q) {
      const term = `%${q.q.toLowerCase()}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('LOWER(p."displayName") LIKE :term', { term })
            .orWhere('LOWER(p.bio) LIKE :term', { term }),
        ),
      );
    }

    qb.orderBy('p."pooledAt"', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, q.page, q.limit);
  }

  // ------------------------------------------------------- reading and audit

  /** Profiles other people have circulated to the caller. */
  /**
   * Profiles other agencies have circulated to this one.
   *
   * `sharedByUserId` has been on the row since the beginning and nothing ever
   * resolved it, so the receiving agent was shown "Via an agent" and had no way
   * to tell *which* — on a screen whose entire purpose is deciding whether to
   * take a stranger's client seriously. The agency behind the share is the
   * single most useful thing on the card, and it was the one thing missing.
   */
  async sharedWithMe(
    actor: AuthUser,
  ): Promise<{ share: ProfileShare; profile: Profile; sharedBy: SharerView | null }[]> {
    const shares = await this.shares.find({
      where: { recipientUserId: actor.userId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (shares.length === 0) return [];

    const [profiles, sharers, agencies] = await Promise.all([
      this.profiles.find({ where: { id: In(shares.map((s) => s.profileId)) } }),
      this.users.find({
        where: { id: In(shares.map((s) => s.sharedByUserId)) },
        select: ['id', 'email'],
      }),
      this.agencies.find({ where: { ownerUserId: In(shares.map((s) => s.sharedByUserId)) } }),
    ]);

    const byId = new Map(profiles.map((p) => [p.id, p]));
    const userById = new Map(sharers.map((u) => [u.id, u]));
    const agencyByUser = new Map(agencies.map((a) => [a.ownerUserId, a]));

    return shares.flatMap((share) => {
      const profile = byId.get(share.profileId);
      if (!profile) return [];

      const agency = agencyByUser.get(share.sharedByUserId);
      const user = userById.get(share.sharedByUserId);
      return [
        {
          share,
          profile,
          sharedBy: agency
            ? {
                agencyName: agency.agencyName,
                city: agency.city ?? null,
                // The agency's own contact, not the sharer's login. An agent
                // ringing about a client should reach the desk.
                contactPhone: agency.contactPhone ?? null,
                email: user?.email ?? null,
              }
            : user
              ? { agencyName: null, city: null, contactPhone: null, email: user.email }
              : null,
        },
      ];
    });
  }

  /** Who the caller has circulated a given profile to. */
  async recipientsOf(actor: AuthUser, profileId: string): Promise<ProfileShare[]> {
    await this.controlled(actor, profileId);
    return this.shares.find({ where: { profileId }, order: { createdAt: 'DESC' } });
  }

  async revoke(actor: AuthUser, shareId: string): Promise<{ success: true }> {
    const share = await this.shares.findOne({ where: { id: shareId } });
    if (!share) throw new NotFoundException('Share not found');
    await this.controlled(actor, share.profileId);

    if (!share.revokedAt) {
      share.revokedAt = new Date();
      await this.shares.save(share);
      await this.audit.record({
        action: AuditAction.PROFILE_SHARE_REVOKED,
        actor,
        resourceType: 'profile',
        resourceId: share.profileId,
        metadata: { shareId, audience: share.audience },
      });
    }
    return { success: true };
  }

  /** Withdraws every outstanding share of a profile, in one go. */
  async revokeAllFor(actor: AuthUser, profileId: string): Promise<{ revoked: number }> {
    await this.controlled(actor, profileId);
    const result = await this.shares.update(
      { profileId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    await this.audit.record({
      action: AuditAction.PROFILE_SHARE_REVOKED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
      metadata: { bulk: true, count: result.affected ?? 0 },
    });
    return { revoked: result.affected ?? 0 };
  }

  /** Does this account hold a live share of that profile? Used for read access. */
  async hasLiveShare(userId: string, profileId: string): Promise<boolean> {
    const count = await this.shares.count({
      where: { profileId, recipientUserId: userId, revokedAt: IsNull() },
    });
    return count > 0;
  }
}
