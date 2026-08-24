import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Interest } from './entities/interest.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { CompatibilityEngine } from './compatibility.engine';
import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../platform/redis/redis.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { Neo4jService } from '../../platform/neo4j/neo4j.service';
import {
  InterestStatus,
  MatchFixedState,
  ProfileClaimStatus,
  ProfileLifecycle,
  ProfileVisibility,
  UserRole,
  isIndividual,
} from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { PublicProfileView, toPublicProfile } from '../users/dto/public-profile.dto';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { SuggestionsQueryDto } from './dto/matchmaking.dto';

export interface Suggestion {
  profile: PublicProfileView;
  score: number;
  breakdown: Record<string, number>;
}

export interface InterestView {
  id: string;
  status: InterestStatus;
  createdAt: Date;
  /** The other side of the interest, in public form. */
  counterpart: PublicProfileView;
  direction: 'incoming' | 'outgoing';
}

/**
 * Matchmaking operates on PROFILES, not accounts.
 *
 * A profile an agent built is matchable the moment it is saved, long before its
 * subject has an account. Keying interests on profile ids is what makes that
 * possible; `sentByUserId` records which account actually clicked, so an
 * agent's activity on a client's behalf stays attributable.
 */
@Injectable()
export class MatchmakingService {
  constructor(
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(ProfileDetails) private readonly details: Repository<ProfileDetails>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly engine: CompatibilityEngine,
    private readonly cfg: AppConfigService,
    private readonly redis: RedisService,
    private readonly outbox: OutboxService,
    private readonly neo4j: Neo4jService,
  ) {}

  /**
   * Resolves which profile an action runs under, and proves the caller controls
   * it. Exactly one of three things is true:
   *
   *  - they own the profile (`profile.userId === actor.userId`);
   *  - they steward it (`profile.managedByUserId === actor.userId`) — an agent
   *    or family member acting for someone, claimed or not;
   *  - they are an admin.
   *
   * Everything else is refused, which is the single ownership rule the whole
   * module leans on.
   */
  async resolveSubject(actor: AuthUser, profileId?: string): Promise<Profile> {
    if (profileId) {
      const profile = await this.profiles.findOne({ where: { id: profileId } });
      if (!profile) throw new NotFoundException('Profile not found');

      const owns = profile.userId !== null && profile.userId === actor.userId;
      const stewards = profile.managedByUserId === actor.userId;
      if (!owns && !stewards && actor.role !== UserRole.ADMIN) {
        throw new ForbiddenException('That profile is not yours to act for');
      }
      return profile;
    }

    // No profile named: fall back to the caller's own.
    //
    // Order matters. An agent gets a profile row at sign-up (it carries their
    // agency name), but they never take part in matchmaking as themselves, so
    // the role is checked BEFORE the lookup — otherwise they would fall through
    // to a misleading "does not take part in matchmaking" refusal instead of
    // being told to name a client.
    if (actor.role === UserRole.AGENT) {
      throw new BadRequestException(
        'Agents act under a client profile — pass profileId (see GET /agents/profiles/actable).',
      );
    }
    if (!isIndividual(actor.role) && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('This account type does not take part in matchmaking');
    }

    const own = await this.profiles.findOne({ where: { userId: actor.userId } });
    if (!own) throw new NotFoundException('Complete your profile first');
    return own;
  }

  /**
   * Matchmaking is only open to a profile that is complete and is not already
   * in a fixed match.
   *
   * Both gates come straight from the spec, and both are about other people:
   * a half-filled profile wastes the time of everyone it is shown to, and a
   * fixed match is the end of matchmaking for that person rather than a pause.
   */
  private async assertMatchmakingOpen(profile: Profile): Promise<void> {
    if (profile.lifecycle !== ProfileLifecycle.ACTIVE) {
      throw new ForbiddenException(`This profile is ${profile.lifecycle} and is not matchmaking`);
    }
    if (!profile.profileCompleted) {
      throw new ForbiddenException(
        'Complete the profile first — basic details, preferences and at least one photo.',
      );
    }
    if (await this.isMatchFixed(profile.id)) {
      throw new ForbiddenException(
        'This match has been fixed. Matchmaking is closed for this profile.',
      );
    }
  }

  /** Has this profile settled on someone? Gates matchmaking and unlocks services. */
  async isMatchFixed(profileId: string): Promise<boolean> {
    const count = await this.interests.count({
      where: [
        { fromProfileId: profileId, matchFixedState: MatchFixedState.CONFIRMED },
        { toProfileId: profileId, matchFixedState: MatchFixedState.CONFIRMED },
      ],
    });
    return count > 0;
  }

  /**
   * Counterparts this profile should never be shown again: anyone either side
   * blocked, and anyone an ended match already ruled out. Withdrawn and
   * rejected interests are deliberately absent — people change their minds,
   * and a rejection is not a permanent exclusion.
   */
  private async excludedCounterpartIds(profileId: string): Promise<Set<string>> {
    const rows = await this.interests.find({
      where: [
        { fromProfileId: profileId, status: In([InterestStatus.BLOCKED, InterestStatus.UNMATCHED]) },
        { toProfileId: profileId, status: In([InterestStatus.BLOCKED, InterestStatus.UNMATCHED]) },
      ],
    });
    return new Set(
      rows.map((r) => (r.fromProfileId === profileId ? r.toProfileId : r.fromProfileId)),
    );
  }

  /**
   * Profiles eligible to appear as candidates. Unclaimed profiles ARE eligible
   * (that is the whole point of an agency building them); what gets excluded is
   * anything attached to a non-individual account, or to a suspended one.
   */
  private async eligibleProfileIds(candidates: Profile[]): Promise<Set<string>> {
    const withAccounts = candidates.filter((c) => c.userId).map((c) => c.userId as string);
    if (withAccounts.length === 0) {
      return new Set(candidates.map((c) => c.id));
    }
    const owners = await this.users.find({
      where: { id: In(withAccounts) },
      select: ['id', 'role', 'isActive'],
    });
    const allowedUserIds = new Set(
      owners.filter((u) => u.isActive && isIndividual(u.role)).map((u) => u.id),
    );
    return new Set(
      candidates
        .filter((c) => (c.userId ? allowedUserIds.has(c.userId) : true))
        .map((c) => c.id),
    );
  }

  async suggestions(actor: AuthUser, q: SuggestionsQueryDto): Promise<PaginatedResult<Suggestion>> {
    const { page, limit } = q;
    const me = await this.resolveSubject(actor, q.profileId);
    await this.assertMatchmakingOpen(me);

    // The filters are part of the identity of the result, so they are part of
    // the cache key. Without that, setting a filter would return the previous,
    // unfiltered page from cache and look like the filter did nothing.
    const cacheKey = `match:suggestions:${me.id}:${page}:${limit}:${this.filterKey(q)}`;

    return this.redis.wrap(cacheKey, this.cfg.matchmaking.suggestionsCacheTtlSeconds, async () => {
      // Prefer graph-ranked candidates when Neo4j is enabled and returns any;
      // otherwise fall back to a Postgres candidate pool.
      let candidates: Profile[] = [];
      if (this.neo4j.ready) {
        const ids = await this.neo4j.suggestions(me.id, this.cfg.matchmaking.maxSuggestions);
        if (ids.length) {
          candidates = await this.profiles.find({
            where: {
              id: In(ids),
              visibility: Not(ProfileVisibility.PRIVATE),
              lifecycle: ProfileLifecycle.ACTIVE,
            },
          });
        }
      }
      if (candidates.length === 0) {
        candidates = await this.profiles.find({
          where: {
            id: Not(me.id),
            visibility: Not(ProfileVisibility.PRIVATE),
            lifecycle: ProfileLifecycle.ACTIVE,
            ...(me.gender ? { gender: Not(me.gender) } : {}),
          },
          take: this.cfg.matchmaking.maxSuggestions,
        });
      }

      const eligible = await this.eligibleProfileIds(candidates);
      const excluded = await this.excludedCounterpartIds(me.id);
      const fixedElsewhere = await this.fixedProfileIds(candidates.map((c) => c.id));
      candidates = candidates.filter(
        (c) => eligible.has(c.id) && !excluded.has(c.id) && !fixedElsewhere.has(c.id),
      );

      // What the viewer may see of each candidate depends on whether the two
      // sides have already matched.
      const acceptedWith = await this.acceptedCounterpartIds(me.id);

      candidates = await this.applyFilters(candidates, q);

      // Sorting by recency is browsing, not recommending.
      //
      // The compatibility floor is what makes a *recommendation* list worth
      // reading — nobody wants a 12% match presented as a suggestion. Applied
      // to "recently added" it does something else entirely: a profile that
      // joined this morning and happens not to match your preferences never
      // appears at all, so the newest list looks empty or stale and reads as
      // broken. That was the reported defect.
      //
      // An explicit `minScore` is still honoured either way: somebody who asked
      // for a floor meant it.
      const browsing = q.sort === 'recent';
      const floor = browsing
        ? (q.minScore ?? 0)
        : Math.max(this.cfg.matchmaking.minScore, q.minScore ?? 0);

      const scored = candidates
        .map((profile) => {
          const { score, breakdown } = this.engine.score(me, profile);
          return { profile, score, breakdown };
        })
        .filter((s) => s.score >= floor)
        .sort((a, b) =>
          browsing
            ? b.profile.createdAt.getTime() - a.profile.createdAt.getTime()
            : b.score - a.score,
        );

      const start = (page - 1) * limit;
      const pageItems = scored.slice(start, start + limit).map((s) => ({
        profile: toPublicProfile(s.profile, { matched: acceptedWith.has(s.profile.id) }),
        score: s.score,
        breakdown: s.breakdown,
      }));
      return paginate(pageItems, scored.length, page, limit);
    });
  }

  /** A stable, short key for whichever filters are actually set. */
  private filterKey(q: SuggestionsQueryDto): string {
    const parts: string[] = [];
    const add = (name: string, value: unknown) => {
      if (value !== undefined && value !== null && value !== '') parts.push(`${name}=${value}`);
    };
    add('ageMin', q.ageMin);
    add('ageMax', q.ageMax);
    add('hMin', q.heightMinCm);
    add('hMax', q.heightMaxCm);
    add('rel', q.religion);
    add('cst', q.caste);
    add('tng', q.motherTongue);
    add('cty', q.city);
    add('qual', q.qualification);
    add('mar', q.maritalStatus);
    add('occ', q.occupationStatus);
    add('min', q.minScore);
    add('sort', q.sort);
    add('new', q.addedWithinDays);
    return parts.length ? parts.join('|') : 'none';
  }

  /**
   * Narrows the candidate pool to what the family asked for.
   *
   * Age, city and recency come off the profile itself; everything else lives in
   * the biodata, which is loaded in one query for the whole pool rather than
   * per candidate. A candidate with no biodata row is dropped as soon as any
   * biodata filter is set — not because they are unsuitable, but because we
   * genuinely cannot say, and putting an unknown in a filtered list is how a
   * filter loses its meaning.
   */
  private async applyFilters(
    candidates: Profile[],
    q: SuggestionsQueryDto,
  ): Promise<Profile[]> {
    let pool = candidates;

    if (q.city) {
      const city = q.city.trim().toLowerCase();
      pool = pool.filter((p) => (p.city ?? '').toLowerCase() === city);
    }

    if (q.ageMin !== undefined || q.ageMax !== undefined) {
      pool = pool.filter((p) => {
        const age = this.ageOf(p.dateOfBirth);
        if (age === null) return false;
        if (q.ageMin !== undefined && age < q.ageMin) return false;
        if (q.ageMax !== undefined && age > q.ageMax) return false;
        return true;
      });
    }

    if (q.addedWithinDays !== undefined) {
      const cutoff = Date.now() - q.addedWithinDays * 24 * 60 * 60 * 1000;
      pool = pool.filter((p) => p.createdAt.getTime() >= cutoff);
    }

    const wantsBiodata =
      q.heightMinCm !== undefined ||
      q.heightMaxCm !== undefined ||
      Boolean(q.religion) ||
      Boolean(q.caste) ||
      Boolean(q.motherTongue) ||
      Boolean(q.qualification) ||
      Boolean(q.maritalStatus) ||
      Boolean(q.occupationStatus);

    if (!wantsBiodata || pool.length === 0) return pool;

    const details = await this.details.find({
      where: { profileId: In(pool.map((p) => p.id)) },
    });
    const byProfile = new Map(details.map((d) => [d.profileId, d]));

    const same = (a: string | null, b?: string) =>
      !b || (a ?? '').trim().toLowerCase() === b.trim().toLowerCase();

    return pool.filter((p) => {
      const d = byProfile.get(p.id);
      if (!d) return false;
      if (q.heightMinCm !== undefined && (d.heightCm ?? 0) < q.heightMinCm) return false;
      if (q.heightMaxCm !== undefined && (d.heightCm ?? 999) > q.heightMaxCm) return false;
      if (!same(d.religion, q.religion)) return false;
      if (!same(d.caste, q.caste)) return false;
      if (!same(d.motherTongue, q.motherTongue)) return false;
      if (!same(d.highestQualification, q.qualification)) return false;
      if (q.maritalStatus && d.maritalStatus !== q.maritalStatus) return false;
      if (q.occupationStatus && d.occupationStatus !== q.occupationStatus) return false;
      return true;
    });
  }

  /** Whole years, from a date-only column. */
  private ageOf(dateOfBirth: string | null): number | null {
    if (!dateOfBirth) return null;
    const dob = new Date(`${dateOfBirth}T00:00:00`);
    if (Number.isNaN(dob.getTime())) return null;

    const now = new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const monthDiff = now.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age -= 1;
    return age;
  }

  private async acceptedCounterpartIds(profileId: string): Promise<Set<string>> {
    const rows = await this.interests.find({
      where: [
        { fromProfileId: profileId, status: InterestStatus.ACCEPTED },
        { toProfileId: profileId, status: InterestStatus.ACCEPTED },
      ],
    });
    return new Set(
      rows.map((r) => (r.fromProfileId === profileId ? r.toProfileId : r.fromProfileId)),
    );
  }

  async sendInterest(
    actor: AuthUser,
    toProfileId: string,
    fromProfileId?: string,
  ): Promise<Interest> {
    const from = await this.resolveSubject(actor, fromProfileId);
    await this.assertMatchmakingOpen(from);
    if (from.id === toProfileId) throw new BadRequestException('Cannot send interest to yourself');

    const target = await this.profiles.findOne({ where: { id: toProfileId } });
    if (!target) throw new NotFoundException('That profile is unavailable');
    if (target.lifecycle !== ProfileLifecycle.ACTIVE) {
      throw new NotFoundException('That profile is unavailable');
    }
    if (target.visibility === ProfileVisibility.PRIVATE) {
      throw new ForbiddenException('That profile is not accepting interests');
    }
    if (target.userId) {
      const owner = await this.users.findOne({ where: { id: target.userId } });
      if (!owner || !owner.isActive) throw new NotFoundException('That profile is unavailable');
      if (!isIndividual(owner.role)) {
        throw new BadRequestException('Interests can only be sent to individual profiles');
      }
    }

    if (await this.isMatchFixed(toProfileId)) {
      throw new BadRequestException('That profile has fixed a match and is no longer matchmaking');
    }
    const blocked = await this.excludedCounterpartIds(from.id);
    if (blocked.has(toProfileId)) {
      throw new ForbiddenException('You can no longer send an interest to that profile');
    }

    const existing = await this.interests.findOne({
      where: { fromProfileId: from.id, toProfileId },
    });
    if (existing) {
      // A withdrawn or unmatched interest is re-opened rather than duplicated:
      // the row is the unique pairing, and its history is worth keeping.
      if (
        existing.status === InterestStatus.WITHDRAWN ||
        existing.status === InterestStatus.REJECTED
      ) {
        existing.status = InterestStatus.PENDING;
        existing.endedByUserId = null;
        existing.endedReason = null;
        existing.sentByUserId = actor.userId;
        return this.interests.save(existing);
      }
      return existing;
    }

    const interest = await this.interests.save(
      this.interests.create({
        fromProfileId: from.id,
        toProfileId,
        sentByUserId: actor.userId,
        status: InterestStatus.PENDING,
      }),
    );
    await this.outbox.record({
      eventType: 'match.interest_sent',
      aggregateType: 'interest',
      payload: {
        interestId: interest.id,
        fromProfileId: from.id,
        toProfileId,
        sentByUserId: actor.userId,
      },
    });
    await this.neo4j.recordInterest(from.id, toProfileId, 'INTERESTED');
    return interest;
  }

  /**
   * Accept or reject. The responder must control the receiving profile — its
   * owner, or the steward who manages it while it is still unclaimed.
   */
  async respond(actor: AuthUser, interestId: string, accept: boolean): Promise<Interest> {
    const interest = await this.interests.findOne({ where: { id: interestId } });
    if (!interest) throw new NotFoundException('Interest not found');

    // Throws unless the caller controls the recipient profile.
    await this.resolveSubject(actor, interest.toProfileId);

    interest.status = accept ? InterestStatus.ACCEPTED : InterestStatus.REJECTED;
    interest.respondedByUserId = actor.userId;
    const saved = await this.interests.save(interest);
    await this.invalidateSuggestions(interest.toProfileId, interest.fromProfileId);

    if (accept) {
      await this.outbox.record({
        eventType: 'match.accepted',
        aggregateType: 'interest',
        payload: {
          interestId: interest.id,
          profileA: interest.fromProfileId,
          profileB: interest.toProfileId,
        },
      });
      await this.neo4j.recordInterest(interest.fromProfileId, interest.toProfileId, 'ACCEPTED');
    }
    return saved;
  }

  private async invalidateSuggestions(...profileIds: string[]): Promise<void> {
    const keys: string[] = [];
    for (const id of profileIds) {
      const found = await this.redis.raw.keys(`match:suggestions:${id}:*`);
      keys.push(...found);
    }
    if (keys.length) await this.redis.del(...keys);
  }

  async accepted(actor: AuthUser, profileId?: string): Promise<InterestView[]> {
    const me = await this.resolveSubject(actor, profileId);
    const rows = await this.interests.find({
      where: [
        { fromProfileId: me.id, status: InterestStatus.ACCEPTED },
        { toProfileId: me.id, status: InterestStatus.ACCEPTED },
      ],
      order: { updatedAt: 'DESC' },
    });
    return this.decorate(me.id, rows, true);
  }

  /** Incoming pending interests for the subject, for the inbox view. */
  async incoming(actor: AuthUser, profileId?: string): Promise<InterestView[]> {
    const me = await this.resolveSubject(actor, profileId);
    const rows = await this.interests.find({
      where: { toProfileId: me.id, status: InterestStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
    return this.decorate(me.id, rows, false);
  }

  /** Interests this profile has sent and is waiting on. */
  async outgoing(actor: AuthUser, profileId?: string): Promise<InterestView[]> {
    const me = await this.resolveSubject(actor, profileId);
    const rows = await this.interests.find({
      where: { fromProfileId: me.id, status: InterestStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
    return this.decorate(me.id, rows, false);
  }

  /** Attaches the counterpart profile in public (privacy-filtered) form. */
  private async decorate(
    myProfileId: string,
    rows: Interest[],
    matched: boolean,
  ): Promise<InterestView[]> {
    if (rows.length === 0) return [];
    const otherIds = rows.map((r) =>
      r.fromProfileId === myProfileId ? r.toProfileId : r.fromProfileId,
    );
    const others = await this.profiles.find({ where: { id: In(otherIds) } });
    const byId = new Map(others.map((p) => [p.id, p]));

    return rows.flatMap((r) => {
      const otherId = r.fromProfileId === myProfileId ? r.toProfileId : r.fromProfileId;
      const other = byId.get(otherId);
      if (!other) return [];
      return [
        {
          id: r.id,
          status: r.status,
          createdAt: r.createdAt,
          counterpart: toPublicProfile(other, { matched }),
          direction: r.toProfileId === myProfileId ? ('incoming' as const) : ('outgoing' as const),
        },
      ];
    });
  }

  /** Which of these candidate profiles have already fixed a match? */
  private async fixedProfileIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.interests.find({
      where: [
        { fromProfileId: In(ids), matchFixedState: MatchFixedState.CONFIRMED },
        { toProfileId: In(ids), matchFixedState: MatchFixedState.CONFIRMED },
      ],
    });
    const out = new Set<string>();
    for (const r of rows) {
      out.add(r.fromProfileId);
      out.add(r.toProfileId);
    }
    return out;
  }

  /**
   * Do these two profiles have an accepted match? Used by chat to decide
   * whether two accounts may talk.
   */
  async hasAcceptedMatch(profileA: string, profileB: string): Promise<boolean> {
    const found = await this.interests.findOne({
      where: [
        { fromProfileId: profileA, toProfileId: profileB, status: InterestStatus.ACCEPTED },
        { fromProfileId: profileB, toProfileId: profileA, status: InterestStatus.ACCEPTED },
      ],
    });
    return Boolean(found);
  }

  /** Profiles a steward may still act for once claimed, for the UI selector. */
  async claimStatusOf(profileId: string): Promise<ProfileClaimStatus | null> {
    const p = await this.profiles.findOne({ where: { id: profileId } });
    return p?.claimStatus ?? null;
  }
}
