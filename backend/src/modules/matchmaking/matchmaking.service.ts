import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { Interest } from './entities/interest.entity';
import { Profile } from '../users/entities/profile.entity';
import { CompatibilityEngine } from './compatibility.engine';
import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from '../../platform/redis/redis.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { Neo4jService } from '../../platform/neo4j/neo4j.service';
import { InterestStatus, ProfileVisibility } from '../../common/enums';
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
    private readonly engine: CompatibilityEngine,
    private readonly cfg: AppConfigService,
    private readonly redis: RedisService,
    private readonly outbox: OutboxService,
    private readonly neo4j: Neo4jService,
  ) {}

  async suggestions(userId: string, page: number, limit: number): Promise<PaginatedResult<Suggestion>> {
    const cacheKey = `match:suggestions:${userId}:${page}:${limit}`;
    return this.redis.wrap(cacheKey, this.cfg.matchmaking.suggestionsCacheTtlSeconds, async () => {
      const me = await this.profiles.findOne({ where: { userId } });
      if (!me) throw new NotFoundException('Complete your profile first');

      // Prefer graph-ranked candidates when Neo4j is enabled and returns any;
      // otherwise fall back to a Postgres candidate pool.
      let candidates: Profile[] = [];
      if (this.neo4j.ready) {
        const ids = await this.neo4j.suggestions(userId, this.cfg.matchmaking.maxSuggestions);
        if (ids.length) {
          candidates = await this.profiles.find({
            where: { userId: In(ids), visibility: Not(ProfileVisibility.PRIVATE) },
          });
        }
      }
      if (candidates.length === 0) {
        candidates = await this.profiles.find({
          where: {
            userId: Not(userId),
            visibility: Not(ProfileVisibility.PRIVATE),
            ...(me.gender ? { gender: Not(me.gender) } : {}),
          },
          take: this.cfg.matchmaking.maxSuggestions,
        });
      }

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

  async sendInterest(fromUserId: string, toUserId: string): Promise<Interest> {
    if (fromUserId === toUserId) throw new BadRequestException('Cannot send interest to yourself');

    const existing = await this.interests.findOne({ where: { fromUserId, toUserId } });
    if (existing) return existing;

    const interest = await this.interests.save(
      this.interests.create({ fromUserId, toUserId, status: InterestStatus.PENDING }),
    );
    await this.outbox.record({
      eventType: 'match.interest_sent',
      aggregateType: 'interest',
      payload: { interestId: interest.id, fromUserId, toUserId },
    });
    await this.neo4j.recordInterest(fromUserId, toUserId, 'INTERESTED');
    return interest;
  }

  async respond(userId: string, interestId: string, accept: boolean): Promise<Interest> {
    const interest = await this.interests.findOne({ where: { id: interestId } });
    if (!interest) throw new NotFoundException('Interest not found');
    if (interest.toUserId !== userId) {
      throw new BadRequestException('Only the recipient can respond');
    }

    interest.status = accept ? InterestStatus.ACCEPTED : InterestStatus.REJECTED;
    const saved = await this.interests.save(interest);
    await this.redis.del(`match:suggestions:${userId}:1:${this.cfg.pagination.defaultLimit}`);

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

  async accepted(userId: string): Promise<Interest[]> {
    return this.interests.find({
      where: [
        { fromUserId: userId, status: InterestStatus.ACCEPTED },
        { toUserId: userId, status: InterestStatus.ACCEPTED },
      ],
    });
  }
}
