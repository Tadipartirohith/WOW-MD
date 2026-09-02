import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, IsNull, Not, Repository } from 'typeorm';
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
import {
  ProfileCardFacts,
  PublicProfileView,
  toCardFacts,
  toPublicProfile,
} from '../users/dto/public-profile.dto';
import { ProfileShortlist } from './entities/shortlist.entity';
import { ProfileShare } from '../circulation/entities/profile-share.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { SuggestionsQueryDto } from './dto/matchmaking.dto';

/**
 * Where the viewer already stands with a candidate.
 *
 * `declined_by_you` and `declined_by_them` are kept apart deliberately. They
 * look the same in the database and mean opposite things to the family reading
 * the card: one is a decision they made and may want to revisit, the other is
 * an answer they were given.
 */
export type InteractionState =
  | 'none'
  | 'interest_sent'
  | 'interest_received'
  | 'accepted'
  | 'declined_by_you'
  | 'declined_by_them';

export interface Suggestion {
  profile: PublicProfileView;
  score: number;
  breakdown: Record<string, number>;
  shortlisted?: boolean;
  note?: string | null;
  interaction?: InteractionState;
  /** Set when a relative sent this over, rather than the engine finding it. */
  sharedByFamily?: {
    sharedAt: string;
    sharerEmail: string | null;
    note: string | null;
  };
}

export interface InterestView {
  id: string;
  status: InterestStatus;
  createdAt: Date;
  /** The other side of the interest, in public form. */
  counterpart: PublicProfileView;
  direction: 'incoming' | 'outgoing';
}

/** An accepted match, with everything the Confirmed Matches card has to state. */
export interface AcceptedMatchView extends InterestView {
  score: number;
  matchFixedState: MatchFixedState;
  confirmedByYouAt: Date | null;
  confirmedByThemAt: Date | null;
  fixedAt: Date | null;
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
    @InjectRepository(ProfileShortlist)
    private readonly shortlists: Repository<ProfileShortlist>,
    @InjectRepository(ProfileShare) private readonly shares: Repository<ProfileShare>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AgentProfile) private readonly agencies: Repository<AgentProfile>,
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
  /**
   * Identity, before anything that binds two families together.
   *
   * Browsing is deliberately left open. Somebody who has not verified yet still
   * needs to see what is on the other side of the step, and a blank page is a
   * poor argument for producing a passport. What is closed is everything that
   * commits: sending an interest, accepting one, and fixing a match.
   *
   * The check lives here rather than in a guard because it is a fact about the
   * *subject profile*, not about the account making the call. An agency is
   * verified as a business and still must not send interests on behalf of a
   * client whose own document has not been seen — the client is the person
   * whose identity the other family is relying on.
   */
  async assertIdentityVerified(profile: Profile, action: string): Promise<void> {
    if (profile.idVerifiedAt) return;
    throw new ForbiddenException(
      profile.idSubmittedAt
        ? `Identity verification is still pending for this profile, so you cannot ${action} yet. ` +
          'A verification officer confirms the document in person.'
        : `Identity verification is required before you can ${action}. ` +
          'Add an identity document on the biodata, and an officer will confirm it.',
    );
  }

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
        /*
         * Newest first, and only then capped.
         *
         * The cap was there all along and the order was not, so the pool was
         * whatever fifty rows Postgres happened to return — which on a database
         * with more than fifty profiles meant a profile that joined this morning
         * usually was not in it. "Recently added" then showed everything except
         * what was recently added, and a search for a specific profile code
         * found nothing, because the profile had been dropped before any filter
         * ran.
         *
         * Recency is the right order for a bounded pool whatever the requested
         * sort: it is the only one that guarantees a new arrival is considered
         * at all, and every other order is applied to the scored list below.
         */
        const base = {
          id: Not(me.id),
          visibility: Not(ProfileVisibility.PRIVATE),
          lifecycle: ProfileLifecycle.ACTIVE,
          ...(me.gender ? { gender: Not(me.gender) } : {}),
        };

        /*
         * A search asks the database, not the pool.
         *
         * Filtering a capped pool is fine for narrowing what is on offer and
         * useless for finding one specific person: somebody typing a profile
         * code has that profile in mind, and it is almost certainly not among
         * the fifty most recent. So a search widens the query instead — same
         * eligibility rules, different starting set.
         */
        const term = q.q?.trim();
        candidates = term
          ? await this.profiles.find({
              where: [
                { ...base, profileCode: term.replace(/\s+/g, '').toUpperCase() },
                { ...base, displayName: ILike(`%${term}%`) },
                { ...base, city: ILike(`%${term}%`) },
              ],
              order: { createdAt: 'DESC' },
              take: this.cfg.matchmaking.maxSuggestions,
            })
          : await this.profiles.find({
              where: base,
              order: { createdAt: 'DESC' },
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
      // Only `score` is recommending. Every other order is browsing, and the
      // compatibility floor has no business in a browse — it makes a profile
      // that joined this morning invisible for not matching preferences the
      // family may not even have set yet.
      const browsing = (q.sort ?? 'score') !== 'score';
      const floor = browsing
        ? (q.minScore ?? 0)
        : Math.max(this.cfg.matchmaking.minScore, q.minScore ?? 0);

      const shortlisted = await this.shortlistedIds(me.id);
      if (q.shortlistedOnly) {
        candidates = candidates.filter((c) => shortlisted.has(c.id));
      }

      const millis = (d: Date | null) => (d ? d.getTime() : 0);
      const orderBy: Record<string, (a: Profile, b: Profile, sa: number, sb: number) => number> = {
        score: (_a, _b, sa, sb) => sb - sa,
        recent: (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        active: (a, b) => millis(b.lastActiveAt) - millis(a.lastActiveAt),
        // A missing date of birth sorts last either way rather than reading as
        // age zero, which would put every incomplete profile at the top of an
        // ascending sort.
        age: (a, b) => (this.ageOf(a.dateOfBirth) ?? 999) - (this.ageOf(b.dateOfBirth) ?? 999),
        ageDesc: (a, b) => (this.ageOf(b.dateOfBirth) ?? -1) - (this.ageOf(a.dateOfBirth) ?? -1),
      };
      const compare = orderBy[q.sort ?? 'score'] ?? orderBy.score;

      // Scored from the biodata, which is where religion, caste, mother tongue,
      // qualification and the partner preferences actually live.
      const pool = await this.detailsFor([me.id, ...candidates.map((c) => c.id)]);
      const mine = { profile: me, details: pool.get(me.id) ?? null };

      const scored = candidates
        .map((profile) => {
          const { score, breakdown } = this.engine.score(mine, {
            profile,
            details: pool.get(profile.id) ?? null,
          });
          return { profile, score, breakdown };
        })
        .filter((s) => s.score >= floor)
        .sort((a, b) => compare(a.profile, b.profile, a.score, b.score));

      const start = (page - 1) * limit;
      const window = scored.slice(start, start + limit);

      // The facts for the cards, and how each one already stands with this
      // profile — both fetched for the page rather than the pool, because a
      // biodata row per candidate over a fifty-profile pool is fifty rows read
      // to render ten.
      const [facts, interactions, agencies] = await Promise.all([
        this.cardFactsFor(window.map((w) => w.profile.id)),
        this.interactionsFor(me.id, window.map((w) => w.profile.id)),
        this.agencyNamesFor(window.map((w) => w.profile)),
      ]);

      const pageItems = window.map((s) => ({
        profile: toPublicProfile(s.profile, {
          matched: acceptedWith.has(s.profile.id),
          card: facts.get(s.profile.id),
          sourceAgency: agencies.get(s.profile.id) ?? null,
        }),
        score: s.score,
        breakdown: s.breakdown,
        shortlisted: shortlisted.has(s.profile.id),
        interaction: interactions.get(s.profile.id) ?? 'none',
      }));
      return paginate(pageItems, scored.length, page, limit);
    });
  }

  /**
   * The biodata rows the engine needs, keyed by profile.
   *
   * One query for the whole pool rather than one per candidate: the pool is
   * capped, and scoring fifty profiles should not be fifty round trips.
   */
  private async detailsFor(profileIds: string[]): Promise<Map<string, ProfileDetails>> {
    if (profileIds.length === 0) return new Map();
    const rows = await this.details.find({ where: { profileId: In(profileIds) } });
    return new Map(rows.map((d) => [d.profileId, d]));
  }

  /**
   * Which agency each of these profiles came from, in one query.
   *
   * A family looking at a card wants to know whose profile it is: it decides
   * who they ring, and where a complaint goes if the details are wrong. The
   * card carried `managed`, which only said that somebody had built it.
   */
  private async agencyNamesFor(profiles: Profile[]): Promise<Map<string, string>> {
    const owners = [...new Set(profiles.map((p) => p.managedByUserId).filter(Boolean))] as string[];
    if (owners.length === 0) return new Map();
    const rows = await this.agencies.find({
      where: { ownerUserId: In(owners) },
      select: ['ownerUserId', 'agencyName'],
    });
    const byOwner = new Map(rows.map((r) => [r.ownerUserId, r.agencyName]));

    const byProfile = new Map<string, string>();
    for (const profile of profiles) {
      const name = profile.managedByUserId ? byOwner.get(profile.managedByUserId) : undefined;
      if (name) byProfile.set(profile.id, name);
    }
    return byProfile;
  }

  /** Biodata facts for a page of cards, in one query. */
  private async cardFactsFor(profileIds: string[]): Promise<Map<string, ProfileCardFacts>> {
    if (profileIds.length === 0) return new Map();
    const rows = await this.details.find({ where: { profileId: In(profileIds) } });
    return new Map(rows.map((d) => [d.profileId, toCardFacts(d)]));
  }

  /**
   * How each candidate already stands with this profile.
   *
   * Showing "Show interest" against somebody who was approached last week, or
   * who has already said no, is the part of the page that wastes the most time
   * — the family sends it again, and the other side sees a second identical
   * request. The card says which it is instead.
   */
  private async interactionsFor(
    profileId: string,
    candidateIds: string[],
  ): Promise<Map<string, InteractionState>> {
    const state = new Map<string, InteractionState>();
    if (candidateIds.length === 0) return state;

    const rows = await this.interests.find({
      where: [
        { fromProfileId: profileId, toProfileId: In(candidateIds) },
        { toProfileId: profileId, fromProfileId: In(candidateIds) },
      ],
      order: { createdAt: 'ASC' },
    });

    for (const row of rows) {
      const other = row.fromProfileId === profileId ? row.toProfileId : row.fromProfileId;
      const outgoing = row.fromProfileId === profileId;
      let value: InteractionState;
      switch (row.status) {
        case InterestStatus.ACCEPTED:
          value = 'accepted';
          break;
        case InterestStatus.REJECTED:
          value = outgoing ? 'declined_by_them' : 'declined_by_you';
          break;
        case InterestStatus.WITHDRAWN:
          value = 'none';
          break;
        default:
          value = outgoing ? 'interest_sent' : 'interest_received';
      }
      // Rows are read oldest first, so a later interest overwrites an earlier
      // one — which is what the family means by "where do we stand now".
      state.set(other, value);
    }
    return state;
  }

  private async shortlistedIds(ownerProfileId: string): Promise<Set<string>> {
    const rows = await this.shortlists.find({
      where: { ownerProfileId },
      select: ['profileId'],
    });
    return new Set(rows.map((r) => r.profileId));
  }

  // ------------------------------------------------------------- shortlist

  /**
   * Keep a profile for a second look.
   *
   * Idempotent: pressing it twice is the same intent, not an error, and a
   * second press with a note updates the note rather than being refused.
   */
  async shortlist(
    actor: AuthUser,
    targetProfileId: string,
    ownerProfileId?: string,
    note?: string,
  ): Promise<{ shortlisted: boolean }> {
    const me = await this.resolveSubject(actor, ownerProfileId);
    if (me.id === targetProfileId) {
      throw new BadRequestException('You cannot shortlist your own profile');
    }
    const target = await this.profiles.findOne({ where: { id: targetProfileId } });
    if (!target) throw new NotFoundException('That profile is unavailable');

    const existing = await this.shortlists.findOne({
      where: { ownerProfileId: me.id, profileId: targetProfileId },
    });
    if (existing) {
      if (note !== undefined) {
        existing.note = note || null;
        await this.shortlists.save(existing);
      }
      return { shortlisted: true };
    }

    await this.shortlists.save(
      this.shortlists.create({
        ownerProfileId: me.id,
        profileId: targetProfileId,
        note: note || null,
      }),
    );
    await this.invalidateSuggestions(me.id);
    return { shortlisted: true };
  }

  async unshortlist(
    actor: AuthUser,
    targetProfileId: string,
    ownerProfileId?: string,
  ): Promise<{ shortlisted: boolean }> {
    const me = await this.resolveSubject(actor, ownerProfileId);
    await this.shortlists.delete({ ownerProfileId: me.id, profileId: targetProfileId });
    await this.invalidateSuggestions(me.id);
    return { shortlisted: false };
  }

  /** The shortlist itself, newest first, with the same card facts as a suggestion. */
  async shortlisted(actor: AuthUser, ownerProfileId?: string): Promise<Suggestion[]> {
    const me = await this.resolveSubject(actor, ownerProfileId);
    const rows = await this.shortlists.find({
      where: { ownerProfileId: me.id },
      order: { createdAt: 'DESC' },
    });
    if (rows.length === 0) return [];

    const profiles = await this.profiles.find({ where: { id: In(rows.map((r) => r.profileId)) } });
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const acceptedWith = await this.acceptedCounterpartIds(me.id);
    const [agencies, facts, interactions, pool] = await Promise.all([
      this.agencyNamesFor(profiles),
      this.cardFactsFor(profiles.map((p) => p.id)),
      this.interactionsFor(me.id, profiles.map((p) => p.id)),
      this.detailsFor([me.id, ...profiles.map((p) => p.id)]),
    ]);
    const mine = { profile: me, details: pool.get(me.id) ?? null };

    return rows
      .map((row) => {
        const profile = byId.get(row.profileId);
        if (!profile) return null;
        const { score, breakdown } = this.engine.score(mine, {
          profile,
          details: pool.get(profile.id) ?? null,
        });
        return {
          profile: toPublicProfile(profile, {
            matched: acceptedWith.has(profile.id),
            card: facts.get(profile.id),
            sourceAgency: agencies.get(profile.id) ?? null,
          }),
          score,
          breakdown,
          shortlisted: true,
          note: row.note,
          interaction: interactions.get(profile.id) ?? 'none',
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }

  /**
   * Profiles a family member has deliberately sent to this person.
   *
   * Scored like any other suggestion, and marked so the card can say where it
   * came from. A share from a relative is not a system recommendation and
   * should not be dressed as one — but it also should not be invisible, which
   * is what it was: shares landed on Shared With Me, a screen an individual
   * does not have.
   */
  async familyShared(actor: AuthUser, profileId?: string): Promise<Suggestion[]> {
    const me = await this.resolveSubject(actor, profileId);

    const shares = await this.shares.find({
      where: { recipientUserId: actor.userId, revokedAt: IsNull(), ignoredAt: IsNull() },
      order: { createdAt: 'DESC' },
      take: 10,
    });
    if (shares.length === 0) return [];

    const sharers = await this.users.find({
      where: { id: In(shares.map((row) => row.sharedByUserId)) },
    });
    const familyUserIds = new Set(
      sharers.filter((u) => u.role === UserRole.FAMILY).map((u) => u.id),
    );
    const fromFamily = shares.filter((row) => familyUserIds.has(row.sharedByUserId));
    if (fromFamily.length === 0) return [];

    const profiles = await this.profiles.find({
      where: {
        id: In(fromFamily.map((row) => row.profileId)),
        lifecycle: ProfileLifecycle.ACTIVE,
      },
    });
    if (profiles.length === 0) return [];

    const byId = new Map(profiles.map((p) => [p.id, p]));
    const acceptedWith = await this.acceptedCounterpartIds(me.id);
    const [agencies, facts, interactions, pool, shortlisted] = await Promise.all([
      this.agencyNamesFor(profiles),
      this.cardFactsFor(profiles.map((p) => p.id)),
      this.interactionsFor(me.id, profiles.map((p) => p.id)),
      this.detailsFor([me.id, ...profiles.map((p) => p.id)]),
      this.shortlistedIds(me.id),
    ]);
    const mine = { profile: me, details: pool.get(me.id) ?? null };
    const sharerById = new Map(sharers.map((u) => [u.id, u]));

    return fromFamily.flatMap((row) => {
      const profile = byId.get(row.profileId);
      if (!profile || profile.id === me.id) return [];
      const { score, breakdown } = this.engine.score(mine, {
        profile,
        details: pool.get(profile.id) ?? null,
      });
      return [
        {
          profile: toPublicProfile(profile, {
            matched: acceptedWith.has(profile.id),
            card: facts.get(profile.id),
            sourceAgency: agencies.get(profile.id) ?? null,
          }),
          score,
          breakdown,
          shortlisted: shortlisted.has(profile.id),
          interaction: interactions.get(profile.id) ?? 'none',
          sharedByFamily: {
            // The person, not the account: "shared by your father" is what the
            // reader wants, and the email address is not that.
            sharedAt: row.createdAt.toISOString(),
            sharerEmail: sharerById.get(row.sharedByUserId)?.email ?? null,
            note: row.message,
          },
        },
      ];
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
    add('prof', q.profession);
    add('q', q.q);
    add('short', q.shortlistedOnly);
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

    /*
     * The one box that searches everything.
     *
     * A profile code is exact — it is a code, and a family typing one has one
     * specific profile in mind, so a partial match on it would be noise. A name
     * is not: people search "anitha" for "Anitha Reddy". Both go in the same
     * box because that is how the person typing thinks about it.
     */
    if (q.q) {
      const term = q.q.trim().toLowerCase();
      const asCode = term.replace(/\s+/g, '');
      pool = pool.filter(
        (p) =>
          p.profileCode.toLowerCase() === asCode ||
          p.displayName.toLowerCase().includes(term) ||
          (p.city ?? '').toLowerCase().includes(term) ||
          (p.bio ?? '').toLowerCase().includes(term),
      );
    }

    if (pool.length === 0) return pool;

    const wantsBiodata =
      q.heightMinCm !== undefined ||
      q.heightMaxCm !== undefined ||
      Boolean(q.religion) ||
      Boolean(q.caste) ||
      Boolean(q.motherTongue) ||
      Boolean(q.qualification) ||
      Boolean(q.maritalStatus) ||
      Boolean(q.occupationStatus) ||
      Boolean(q.profession);

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
      if (q.profession) {
        const wanted = q.profession.trim().toLowerCase();
        const haystack = [
          d.employment?.role,
          d.employment?.designation,
          d.employment?.company,
          d.business?.name,
        ]
          .filter((v): v is string => typeof v === 'string')
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(wanted)) return false;
      }
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
    await this.assertIdentityVerified(from, 'send an interest');
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

    /*
     * The suggestion pages both sides see are now wrong.
     *
     * Responding and withdrawing already did this; sending did not, and the
     * consequence was reported three separate ways. Suggestions are cached for
     * two minutes, and each card carries an `interaction` telling the client
     * whether an interest already exists — so for those two minutes the list
     * kept saying "none". The button stayed as "Show interest" and could be
     * pressed again, and the profile did not move out of the pending view.
     *
     * It read as the click doing nothing. It had done everything except tell
     * anybody.
     */
    await this.invalidateSuggestions(from.id, toProfileId);
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
    const recipient = await this.resolveSubject(actor, interest.toProfileId);

    // Declining is always available. Requiring a verified document before
    // somebody may say no would trap them in a conversation they have already
    // decided against, which is the opposite of what the gate is for.
    //
    // The same reasoning is why a fixed match closes accepting but not
    // declining: matchmaking is over for this profile, and the pending
    // requests still sitting in the queue need clearing rather than freezing.
    //
    // Sending was already refused in both directions once a match is fixed.
    // Accepting was not, so a settled profile could still say yes to a request
    // that arrived before the match — collecting a second accepted interest,
    // and with it a second conversation, because chat is opened by exactly
    // that. Both ends are checked: the requests either side is holding are as
    // closed as the ones nobody has sent yet.
    if (accept) {
      await this.assertIdentityVerified(recipient, 'accept an interest');
      const settled =
        (await this.isMatchFixed(interest.toProfileId)) ||
        (await this.isMatchFixed(interest.fromProfileId));
      if (settled) {
        throw new ForbiddenException(
          'This match has been fixed. Matchmaking is closed, so interests can no longer be accepted.',
        );
      }
    }

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

  /**
   * Matches both sides agreed to, with where each one stands.
   *
   * A row here used to carry a name and a town, which is not enough to act on:
   * "Match Fixed" as a heading with nothing under it explaining whose match,
   * confirmed by whom, or when, was the reported complaint. The state, both
   * confirmations and the score travel with the row so the card can say it.
   */
  async accepted(actor: AuthUser, profileId?: string): Promise<AcceptedMatchView[]> {
    const me = await this.resolveSubject(actor, profileId);
    const rows = await this.interests.find({
      where: [
        { fromProfileId: me.id, status: InterestStatus.ACCEPTED },
        { toProfileId: me.id, status: InterestStatus.ACCEPTED },
      ],
      order: { updatedAt: 'DESC' },
    });
    const views = await this.decorate(me.id, rows, true);
    const byId = new Map(rows.map((r) => [r.id, r]));

    const counterparts = await this.profiles.find({
      where: { id: In(views.map((v) => v.counterpart.id)) },
    });
    const pool = await this.detailsFor([me.id, ...counterparts.map((c) => c.id)]);
    const mine = { profile: me, details: pool.get(me.id) ?? null };
    const scoreFor = new Map(
      counterparts.map(
        (c) =>
          [c.id, this.engine.score(mine, { profile: c, details: pool.get(c.id) ?? null }).score] as const,
      ),
    );

    return views.map((view) => {
      const row = byId.get(view.id);
      const mineIsFrom = row?.fromProfileId === me.id;
      const myConfirmation = mineIsFrom ? row?.fixedConfirmedFromAt : row?.fixedConfirmedToAt;
      const theirConfirmation = mineIsFrom ? row?.fixedConfirmedToAt : row?.fixedConfirmedFromAt;

      return {
        ...view,
        score: scoreFor.get(view.counterpart.id) ?? 0,
        matchFixedState: row?.matchFixedState ?? MatchFixedState.NONE,
        confirmedByYouAt: myConfirmation ?? null,
        confirmedByThemAt: theirConfirmation ?? null,
        // The date the match became fixed is the later of the two, because it
        // is not fixed until both have said so.
        fixedAt:
          myConfirmation && theirConfirmation
            ? new Date(Math.max(myConfirmation.getTime(), theirConfirmation.getTime()))
            : null,
      };
    });
  }

  /**
   * Every interest this profile is part of, grouped the way a person thinks
   * about them.
   *
   * The pieces existed as three endpoints — incoming, outgoing, accepted — and
   * nothing at all for declined, so a client wanting the whole picture made
   * three calls and did the grouping itself. Which is why nobody built the
   * screen, and why a profile could not answer the question people actually
   * ask: who has asked about me, who have I asked, and what came of it.
   *
   * `actions` travels with each row rather than being inferred by the client.
   * What you may do to an interest depends on its status *and* on which side of
   * it you are — you decline one that came to you and unsend one you sent, and
   * those are different buttons on rows that otherwise look identical. A client
   * working that out is a second copy of the rule, in the place least able to
   * enforce it.
   */
  async interestBoard(actor: AuthUser, profileId?: string) {
    const me = await this.resolveSubject(actor, profileId);

    const rows = await this.interests.find({
      where: [{ fromProfileId: me.id }, { toProfileId: me.id }],
      order: { updatedAt: 'DESC' },
    });

    // Decorated in two passes, because an accepted interest is allowed to show
    // more of the counterpart than a pending one. Doing it in one pass would
    // mean choosing which of those two to get wrong.
    const accepted = rows.filter((r) => r.status === InterestStatus.ACCEPTED);
    const rest = rows.filter((r) => r.status !== InterestStatus.ACCEPTED);
    const [acceptedViews, restViews] = await Promise.all([
      this.decorate(me.id, accepted, true),
      this.decorate(me.id, rest, false),
    ]);

    const status = new Map(rows.map((r) => [r.id, r.status]));
    const byId = new Map(rows.map((r) => [r.id, r]));

    // Everybody's name, for saying who accepted. One read rather than one per
    // row, and it covers both sides because either can be the accepter.
    const names = new Map(
      (
        await this.profiles.find({
          where: { id: In(rows.flatMap((r) => [r.fromProfileId, r.toProfileId])) },
          select: ['id', 'displayName', 'gender'],
        })
      ).map((pr) => [pr.id, pr]),
    );

    const matchmakingClosed = await this.isMatchFixed(me.id);

    const withActions = [...acceptedViews, ...restViews].map((view) => {
      const st = status.get(view.id)!;
      const row = byId.get(view.id)!;
      const incoming = view.direction === 'incoming';
      const pending = st === InterestStatus.PENDING;

      /*
       * Who said yes.
       *
       * Only the side that received an interest can accept it, so the accepter
       * is always the `to` profile — but "accepted" on its own, with no name
       * against it, was the reported complaint. Somebody who has sent five
       * interests and received three cannot tell from the word alone whether
       * they agreed to this or somebody agreed to them.
       */
      const accepter = st === InterestStatus.ACCEPTED ? names.get(row.toProfileId) : undefined;
      const acceptedBy = accepter
        ? {
            profileId: accepter.id,
            displayName: accepter.displayName,
            gender: accepter.gender ?? null,
            // Whether it was this profile that accepted, so the client can say
            // "you accepted" rather than making the reader work it out.
            mine: row.toProfileId === me.id,
          }
        : null;

      return {
        ...view,
        acceptedBy,
        actions: {
          // Accepting closes when the match is fixed, because respond() now
          // refuses it. Declining stays open so the queue can still be
          // cleared, and unsending stays open so a request this profile sent
          // before settling can be taken back.
          accept: incoming && pending && !matchmakingClosed,
          decline: incoming && pending,
          unsend: !incoming && pending,
          // Offered wherever there is somebody to block: a request you have not
          // answered, and a match you have. Those are the two places people
          // actually reach for it.
          block: st === InterestStatus.PENDING || st === InterestStatus.ACCEPTED,
        },
      };
    });

    const of = (...want: InterestStatus[]) => withActions.filter((v) => want.includes(status.get(v.id)!));

    const pending = of(InterestStatus.PENDING);
    const received = pending.filter((v) => v.direction === 'incoming');
    const sent = pending.filter((v) => v.direction === 'outgoing');
    const acceptedList = of(InterestStatus.ACCEPTED);
    const declined = of(InterestStatus.REJECTED);

    return {
      profileId: me.id,
      received,
      sent,
      /*
       * Everything still waiting on somebody, from either side.
       *
       * Deliberately the union of received and sent rather than a fourth
       * disjoint bucket. The document lists Pending as its own section, and
       * "waiting on an answer" is worth seeing in one place regardless of who
       * asked — but the counts below treat it as the union it is, so nothing
       * is added up twice.
       */
      pending,
      accepted: acceptedList,
      declined,
      withdrawn: of(InterestStatus.WITHDRAWN),
      blocked: of(InterestStatus.BLOCKED),
      counts: {
        received: received.length,
        sent: sent.length,
        pending: pending.length,
        accepted: acceptedList.length,
        declined: declined.length,
      },
    };
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
