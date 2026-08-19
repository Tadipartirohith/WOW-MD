import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { AuthService } from '../auth/auth.service';
import { CreateClientDto } from '../auth/dto/auth.dto';
import { ClientSearchDto } from './dto/agent.dto';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

/** Shape returned to agents. Never leaks password or refresh-token material. */
export interface ClientView {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  displayName: string | null;
  city: string | null;
  profileCompleted: boolean;
}

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly auth: AuthService,
  ) {}

  async createClient(agentId: string, dto: CreateClientDto): Promise<ClientView> {
    const user = await this.auth.createManagedClient(agentId, dto);
    return this.toView(user, await this.profiles.findOne({ where: { userId: user.id } }));
  }

  /**
   * The agent's book of business, always scoped to `managedByAgentId`.
   *
   * Profiles are loaded in a second query rather than joined: mixing a raw join
   * alias with orderBy + skip/take makes TypeORM build an ORDER BY over columns
   * it has no metadata for, which throws at runtime.
   */
  async listClients(agentId: string, q: ClientSearchDto): Promise<PaginatedResult<ClientView>> {
    const qb = this.users
      .createQueryBuilder('u')
      .where('u."managedByAgentId" = :agentId', { agentId });

    if (q.isActive !== undefined) qb.andWhere('u."isActive" = :isActive', { isActive: q.isActive });

    if (q.q) {
      const term = `%${q.q.toLowerCase()}%`;
      qb.andWhere(
        `(LOWER(u.email) LIKE :term
          OR EXISTS (
            SELECT 1 FROM profiles p
             WHERE p."userId" = u.id AND LOWER(p."displayName") LIKE :term
          ))`,
        { term },
      );
    }

    qb.orderBy('u."createdAt"', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [rows, total] = await qb.getManyAndCount();
    if (rows.length === 0) return paginate([], total, q.page, q.limit);

    const profiles = await this.profiles.find({
      where: { userId: In(rows.map((r) => r.id)) },
    });
    const byUser = new Map(profiles.map((p) => [p.userId, p]));
    const data = rows.map((u) => this.toView(u, byUser.get(u.id) ?? null));
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
    return this.toView(client, await this.profiles.findOne({ where: { userId: client.id } }));
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
    return this.toView(client, await this.profiles.findOne({ where: { userId: client.id } }));
  }

  private toView(user: User, profile: Profile | null): ClientView {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
      displayName: profile?.displayName ?? null,
      city: profile?.city ?? null,
      profileCompleted: profile?.profileCompleted ?? false,
    };
  }
}
