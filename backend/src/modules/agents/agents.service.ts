import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { MatchFixedState, ProfileLifecycle } from '../../common/enums';
import { ClientSearchDto } from './dto/agent.dto';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

/** Headline numbers for the agent dashboard (EZ1-I79). */
export interface AgentStats {
  totalClients: number;
  matchesFixed: number;
  remainingClients: number;
  totalInterests: number;
}

/**
 * Shape returned to agents. Never leaks password or refresh-token material.
 *
 * Note there is no `createClient` here any more. An agent cannot conjure an
 * account directly: they build a managed profile (ManagedProfilesService) and
 * email an invitation (InvitationsService), and the account only exists once
 * the subject accepts and chooses their own password.
 */
export interface ClientView {
  /** The profile. Always present — it is the thing the agent built. */
  profileId: string;
  profileCode: string;
  /**
   * The account, once there is one.
   *
   * Null for a client who has not been invited, or has been invited and not yet
   * accepted. That is a normal and long-lived state in this business: an agency
   * builds the profile from a form filled in at the counter, and the person may
   * never sign in at all.
   */
  id: string | null;
  email: string | null;
  role: string | null;
  isActive: boolean;
  createdAt: Date;
  displayName: string | null;
  city: string | null;
  profileCompleted: boolean;
  /** self | invited | claimed — what the agent may do with it. */
  claimStatus: string;
}

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
  ) {}

  /**
   * Headline counts for the agent dashboard (EZ1-I79): how many clients the
   * agent runs, how many have a fixed match, how many are still open, and the
   * total interests their book has taken part in. Derived live so it can never
   * drift from the client list and the matches.
   */
  async stats(agentId: string): Promise<AgentStats> {
    const rows = await this.profiles.find({
      where: { managedByUserId: agentId, archivedAt: IsNull() },
      select: ['id'],
    });
    const ids = new Set(rows.map((r) => r.id));
    const totalClients = ids.size;
    if (totalClients === 0) {
      return { totalClients: 0, matchesFixed: 0, remainingClients: 0, totalInterests: 0 };
    }

    const profileIds = [...ids];
    const interests = await this.interests.find({
      where: [{ fromProfileId: In(profileIds) }, { toProfileId: In(profileIds) }],
      select: ['fromProfileId', 'toProfileId', 'matchFixedState'],
    });

    // A client counts as "fixed" once any interest on either side is confirmed.
    const fixed = new Set<string>();
    for (const i of interests) {
      if (i.matchFixedState !== MatchFixedState.CONFIRMED) continue;
      if (ids.has(i.fromProfileId)) fixed.add(i.fromProfileId);
      if (ids.has(i.toProfileId)) fixed.add(i.toProfileId);
    }
    const matchesFixed = fixed.size;

    return {
      totalClients,
      matchesFixed,
      remainingClients: totalClients - matchesFixed,
      totalInterests: interests.length,
    };
  }

  /**
   * The agent's whole book, whether or not the client has an account yet.
   *
   * This listed *accounts* — `users` where `managedByAgentId` matched — which
   * meant a profile the agency had built and not yet invited could not appear
   * at all, because no account existed for it to be found by. So an agent
   * looking at Client Profiles saw four people and My Clients showed three,
   * with nothing to explain where the fourth had gone.
   *
   * It lists profiles now, and attaches the account to the ones that have one.
   * Claim status decides what an agent may *do* with a client, not whether the
   * client is in their own list.
   *
   * Profiles and accounts are two queries rather than a join: mixing a raw join
   * alias with orderBy + skip/take makes TypeORM build an ORDER BY over columns
   * it has no metadata for, which throws at runtime.
   */
  /**
   * The cities this agent's own clients are in, for the Location filter.
   *
   * Derived rather than a fixed list: the filter should offer the places this
   * agency actually works in, and a hard-coded set goes stale the first time
   * they take somebody on somewhere new (EZ1-I241).
   */
  async clientCities(agentId: string): Promise<{ cities: string[] }> {
    const rows = await this.profiles
      .createQueryBuilder('p')
      .select('DISTINCT p."city"', 'city')
      .where('p."managedByUserId" = :agentId', { agentId })
      .andWhere('p."city" IS NOT NULL')
      .andWhere("p.\"city\" <> ''")
      .orderBy('p."city"', 'ASC')
      .getRawMany<{ city: string }>();
    return { cities: rows.map((r) => r.city) };
  }

  async listClients(agentId: string, q: ClientSearchDto): Promise<PaginatedResult<ClientView>> {
    const qb = this.profiles
      .createQueryBuilder('p')
      .where('p."managedByUserId" = :agentId', { agentId });

    /*
     * Closed profiles stay out of the list unless somebody asks for them by
     * name. They are kept for the record and are never matched or circulated,
     * so putting them in the default view would bury the live book -- but an
     * agent filtering for "Closed" plainly means to see them (EZ1-I241).
     */
    if (q.lifecycle === ProfileLifecycle.ARCHIVED) {
      qb.andWhere('p."lifecycle" = :lifecycle', { lifecycle: q.lifecycle });
    } else {
      qb.andWhere('p."archivedAt" IS NULL');
      if (q.lifecycle) qb.andWhere('p."lifecycle" = :lifecycle', { lifecycle: q.lifecycle });
    }

    if (q.claimStatus) {
      qb.andWhere('p."claimStatus" = :claimStatus', { claimStatus: q.claimStatus });
    }

    if (q.city) {
      qb.andWhere('LOWER(p."city") = LOWER(:city)', { city: q.city });
    }

    /*
     * A client either holds an account or is still a profile the agency owns
     * on their behalf. That is the distinction the page calls Client Type.
     */
    if (q.hasAccount !== undefined) {
      qb.andWhere(q.hasAccount === true ? 'p."userId" IS NOT NULL' : 'p."userId" IS NULL');
    }

    if (q.q) {
      const term = `%${q.q.toLowerCase()}%`;
      // Name, client id, email, and the contact numbers -- an agent looking
      // somebody up has whichever of those the client gave them (EZ1-I241).
      qb.andWhere(
        `(LOWER(p."displayName") LIKE :term
          OR LOWER(p."profileCode") LIKE :term
          OR p."contactPhone" LIKE :term
          OR LOWER(COALESCE(p."contactEmail", '')) LIKE :term
          OR EXISTS (
            SELECT 1 FROM users u
            WHERE u.id = p."userId"
              AND (LOWER(COALESCE(u.email, '')) LIKE :term OR u.phone LIKE :term)
          ))`,
        { term },
      );
    }

    /*
     * "Active" is a question about the account, and a profile without one has
     * no answer. Rather than guess, an explicit filter on account status
     * narrows to clients who actually have accounts — which is what somebody
     * asking that question means.
     */
    if (q.isActive !== undefined) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM users u WHERE u.id = p."userId" AND u."isActive" = :isActive)`,
        { isActive: q.isActive === true },
      );
    }

    qb.orderBy('p."createdAt"', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [rows, total] = await qb.getManyAndCount();
    if (rows.length === 0) return paginate([], total, q.page, q.limit);

    const userIds = rows.map((r) => r.userId).filter((id): id is string => Boolean(id));
    const users = userIds.length ? await this.users.find({ where: { id: In(userIds) } }) : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    const data = rows.map((p) => this.toView(p, p.userId ? (byId.get(p.userId) ?? null) : null));
    return paginate(data, total, q.page, q.limit);
  }

  /**
   * The single choke point for "may this agent act for this client?".
   * Every agent-on-behalf path routes through here, so the ownership rule is
   * stated once instead of being re-derived per feature.
   */
  async assertManages(agentId: string, clientUserId: string): Promise<User> {
    const client = await this.users.findOne({ where: { id: clientUserId } });
    if (!client) throw new NotFoundException('Client not found');
    if (client.managedByAgentId !== agentId) {
      throw new ForbiddenException('That client is not on your books');
    }
    if (!client.isActive) throw new ForbiddenException('That client account is deactivated');
    return client;
  }

  async getClient(agentId: string, clientUserId: string): Promise<ClientView> {
    const client = await this.assertManages(agentId, clientUserId);
    const profile = await this.profiles.findOne({ where: { userId: client.id } });
    if (!profile) throw new NotFoundException('That client has no profile');
    return this.toView(profile, client);
  }

  async setClientStatus(
    agentId: string,
    clientUserId: string,
    isActive: boolean,
  ): Promise<ClientView> {
    // Not assertManages: that refuses deactivated clients, which would make
    // reactivation impossible. Ownership is still enforced.
    const client = await this.users.findOne({ where: { id: clientUserId } });
    if (!client) throw new NotFoundException('Client not found');
    if (client.managedByAgentId !== agentId) {
      throw new ForbiddenException('That client is not on your books');
    }
    client.isActive = isActive;
    await this.users.save(client);
    const profile = await this.profiles.findOne({ where: { userId: client.id } });
    if (!profile) throw new NotFoundException('That client has no profile');
    return this.toView(profile, client);
  }

  private toView(profile: Profile, user: User | null): ClientView {
    return {
      profileId: profile.id,
      profileCode: profile.profileCode,
      id: user?.id ?? null,
      email: user?.email ?? null,
      role: user?.role ?? null,
      // A profile with no account is not "inactive" — nobody has deactivated
      // anything. It is simply a client who has not signed in yet.
      isActive: user ? user.isActive : true,
      createdAt: profile.createdAt,
      displayName: profile.displayName,
      city: profile.city ?? null,
      profileCompleted: profile.profileCompleted,
      claimStatus: profile.claimStatus,
    };
  }
}
