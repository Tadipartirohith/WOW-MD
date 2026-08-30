import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { ClientSearchDto } from './dto/agent.dto';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

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
  ) {}

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
  async listClients(agentId: string, q: ClientSearchDto): Promise<PaginatedResult<ClientView>> {
    const qb = this.profiles
      .createQueryBuilder('p')
      .where('p."managedByUserId" = :agentId', { agentId })
      .andWhere('p."archivedAt" IS NULL');

    if (q.q) {
      const term = `%${q.q.toLowerCase()}%`;
      qb.andWhere(
        `(LOWER(p."displayName") LIKE :term
          OR LOWER(p."profileCode") LIKE :term
          OR EXISTS (
            SELECT 1 FROM users u WHERE u.id = p."userId" AND LOWER(u.email) LIKE :term
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
        { isActive: q.isActive },
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
