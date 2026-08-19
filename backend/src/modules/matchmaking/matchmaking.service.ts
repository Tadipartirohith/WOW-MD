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
import { AgentsService } from '../agents/agents.service';
import { InterestStatus, ProfileVisibility, UserRole, isIndividual } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

export interface Suggestion {
  profile: Profile;
  score: number;
  breakdown: Record<string, number>;
}

@Injectable()
export class MatchmakingService {
  constructor(
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly engine: CompatibilityEngine,
    private readonly cfg: AppConfigService,
    private readonly redis: RedisService,
    private readonly outbox: OutboxService,
    private readonly neo4j: Neo4jService,
    private readonly agents: AgentsService,
  ) {}

  /**
   * Resolves whose matchmaking identity an action runs under.
   *
   * An individual always acts as themselves. An agent must name a client, and
   * may only name one on their own books — this is what stops an agent from
   * sending interests from arbitrary accounts.
   */
  private async resolveSubject(actor: AuthUser, onBehalfOfUserId?: string): Promise<string> {
    if (actor.role === UserRole.AGENT) {
      if (!onBehalfOfUserId) {
        throw new BadRequestException(
          'Agents must specify onBehalfOfUserId — matchmaking runs under a client identity',
        );
      }
      await this.agents.assertManages(actor.userId, onBehalfOfUserId);
      return onBehalfOfUserId;
    }
    if (onBehalfOfUserId && onBehalfOfUserId !== actor.userId) {
      throw new ForbiddenException('Only agents can act on behalf of another account');
    }
    if (!isIndividual(actor.role) && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('This account type does not take part in matchmaking');
    }
    return actor.userId;
  }

  /** Only individual accounts are ever surfaced as match candidates. */
  private async individualUserIds(candidateIds: string[]): Promise<Set<string>> {
    if (candidateIds.length === 0) return new Set();
    const rows = await this.users.find({
      where: { id: In(candidateIds), isActive: true },
      select: ['id', 'role'],
    });
    return new Set(rows.filter((u) => isIndividual(u.role)).map((u) => u.id));
  }

  async suggestions(
    actor: AuthUser,
    page: number,
    limit: number,
    onBehalfOfUserId?: string,
  ): Promise<PaginatedResult<Suggestion>> {
    const subjectId = await this.resolveSubject(actor, onBehalfOfUserId);
    const cacheKey = `match:suggestions:${subjectId}:${page}:${limit}`;

    return this.redis.wrap(cacheKey, this.cfg.matchmaking.suggestionsCacheTtlSeconds, async () => {
      const me = await this.profiles.findOne({ where: { userId: subjectId } });
      if (!me) throw new NotFoundException('Complete your profile first');

      // Prefer graph-ranked candidates when Neo4j is enabled and returns any;
      // otherwise fall back to a Postgres candidate pool.
      let candidates: Profile[] = [];
      if (this.neo4j.ready) {
        const ids = await this.neo4j.suggestions(subjectId, this.cfg.matchmaking.maxSuggestions);
        if (ids.length) {
          candidates = await this.profiles.find({
            where: { userId: In(ids), visibility: Not(ProfileVisibility.PRIVATE) },
          });
        }
      }
      if (candidates.length === 0) {
        candidates = await this.profiles.find({
          where: {
            userId: Not(subjectId),
            visibility: Not(ProfileVisibility.PRIVATE),
            ...(me.gender ? { gender: Not(me.gender) } : {}),
          },
          take: this.cfg.matchmaking.maxSuggestions,
        });
      }

      // Drop vendor/planner/agent accounts and deactivated users from the pool.
      const allowed = await this.individualUserIds(candidates.map((c) => c.userId));
      candidates = candidates.filter((c) => allowed.has(c.userId));

      const scored = candidates
        .map((profile) => {
          const { score, breakdown } = this.engine.score(me, profile);
          return { profile, score, breakdown };
        })
        .filter((s) => s.score >= this.cfg.matchmaking.minScore)
        .sort((a, b) => b.score - a.score);

      const start = (page - 1) * limit;
      return paginate(scored.slice(start, start + limit), scored.length, page, limit);
    });
  }

  async sendInterest(
    actor: AuthUser,
    toUserId: string,
    onBehalfOfUserId?: string,
  ): Promise<Interest> {
    const fromUserId = await this.resolveSubject(actor, onBehalfOfUserId);
    if (fromUserId === toUserId) throw new BadRequestException('Cannot send interest to yourself');

    const target = await this.users.findOne({ where: { id: toUserId } });
    if (!target || !target.isActive) throw new NotFoundException('That profile is unavailable');
    if (!isIndividual(target.role)) {
      throw new BadRequestException('Interests can only be sent to individual profiles');
    }

    const existing = await this.interests.findOne({ where: { fromUserId, toUserId } });
    if (existing) return existing;

    const interest = await this.interests.save(
      this.interests.create({ fromUserId, toUserId, status: InterestStatus.PENDING }),
    );
    await this.outbox.record({
      eventType: 'match.interest_sent',
      aggregateType: 'interest',
      payload: { interestId: interest.id, fromUserId, toUserId, sentByUserId: actor.userId },
    });
    await this.neo4j.recordInterest(fromUserId, toUserId, 'INTERESTED');
    return interest;
  }

  /**
   * Accept/reject. Only the recipient may respond — or their agent, since an
   * agent-managed client may have their agent handling the inbox for them.
   */
  async respond(actor: AuthUser, interestId: string, accept: boolean): Promise<Interest> {
    const interest = await this.interests.findOne({ where: { id: interestId } });
    if (!interest) throw new NotFoundException('Interest not found');

    if (interest.toUserId !== actor.userId) {
      if (actor.role !== UserRole.AGENT) {
        throw new ForbiddenException('Only the recipient can respond to this interest');
      }
      await this.agents.assertManages(actor.userId, interest.toUserId);
    }

    interest.status = accept ? InterestStatus.ACCEPTED : InterestStatus.REJECTED;
    const saved = await this.interests.save(interest);
    await this.redis.del(
      `match:suggestions:${interest.toUserId}:1:${this.cfg.pagination.defaultLimit}`,
    );

    if (accept) {
      await this.outbox.record({
        eventType: 'match.accepted',
        aggregateType: 'interest',
        payload: {
          interestId: interest.id,
          userA: interest.fromUserId,
          userB: interest.toUserId,
        },
      });
      await this.neo4j.recordInterest(interest.fromUserId, interest.toUserId, 'ACCEPTED');
    }
    return saved;
  }

  async accepted(actor: AuthUser, onBehalfOfUserId?: string): Promise<Interest[]> {
    const subjectId = await this.resolveSubject(actor, onBehalfOfUserId);
    return this.interests.find({
      where: [
        { fromUserId: subjectId, status: InterestStatus.ACCEPTED },
        { toUserId: subjectId, status: InterestStatus.ACCEPTED },
      ],
    });
  }

  /** Incoming pending interests for the subject, for the inbox view. */
  async incoming(actor: AuthUser, onBehalfOfUserId?: string): Promise<Interest[]> {
    const subjectId = await this.resolveSubject(actor, onBehalfOfUserId);
    return this.interests.find({
      where: { toUserId: subjectId, status: InterestStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
  }
}
