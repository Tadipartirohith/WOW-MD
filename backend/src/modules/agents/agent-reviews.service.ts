import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { AgentProfile } from './entities/agent-profile.entity';
import { AgentReview } from './entities/agent-review.entity';
import { SubmitAgentReviewDto } from './dto/agent-review.dto';

export interface AgentRating {
  average: number;
  count: number;
}

/** One client's review as the agent sees it on their own reviews page. */
export interface AgentReviewItem {
  rating: number;
  comment: string | null;
  clientName: string;
  createdAt: Date;
}

export interface MyReviewsView {
  rating: AgentRating;
  reviews: AgentReviewItem[];
}

export interface MyAgentView {
  agent: { id: string; agencyName: string | null; city: string | null; about: string | null } | null;
  rating: AgentRating;
  myReview: { rating: number; comment: string | null } | null;
}

/**
 * A managed client rates the agent who represents them.
 *
 * The signal is one standing review per (agent, client) pair, editable in
 * place — a relationship, not a transaction. The write is guarded on the same
 * `managedByAgentId` link that makes someone a client of that agent: you can
 * only rate the agent who actually manages your account.
 *
 * The aggregate is computed on read rather than denormalised onto the agent
 * profile: a client sees exactly one agent, so there is no hot list to keep
 * warm, and an always-correct number beats a cached one that can drift.
 */
@Injectable()
export class AgentReviewsService {
  constructor(
    @InjectRepository(AgentReview) private readonly reviews: Repository<AgentReview>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(AgentProfile) private readonly agencies: Repository<AgentProfile>,
  ) {}

  /** Average (2dp) and count over every review for one agent. */
  async getRating(agentId: string): Promise<AgentRating> {
    const row = await this.reviews
      .createQueryBuilder('r')
      .select('AVG(r.rating)', 'avg')
      .addSelect('COUNT(r.id)', 'count')
      .where('r.agentId = :agentId', { agentId })
      .getRawOne<{ avg: string | null; count: string }>();
    const avg = row?.avg ?? null;
    const count = row?.count ?? '0';

    return {
      average: Math.round(Number(avg ?? 0) * 100) / 100,
      count: Number(count ?? 0),
    };
  }

  /**
   * The agent's own reviews page: their aggregate rating plus every individual
   * client review, newest first, each named by the client's profile display
   * name (falling back to their email). This is the agent-facing side of
   * EZ1-I206 — the client writes on `getMyAgent`, the agent reads it here.
   */
  async getMyReviews(agentUserId: string): Promise<MyReviewsView> {
    const [rating, rows] = await Promise.all([
      this.getRating(agentUserId),
      this.reviews.find({ where: { agentId: agentUserId }, order: { createdAt: 'DESC' } }),
    ]);

    const userIds = [...new Set(rows.map((r) => r.userId))];
    const [profiles, users] = await Promise.all([
      userIds.length ? this.profiles.find({ where: { userId: In(userIds) } }) : Promise.resolve([]),
      userIds.length ? this.users.find({ where: { id: In(userIds) } }) : Promise.resolve([]),
    ]);
    const nameOf = (uid: string) =>
      profiles.find((p) => p.userId === uid)?.displayName ??
      users.find((u) => u.id === uid)?.email ??
      'A client';

    return {
      rating,
      reviews: rows.map((r) => ({
        rating: r.rating,
        comment: r.comment,
        clientName: nameOf(r.userId),
        createdAt: r.createdAt,
      })),
    };
  }

  /**
   * The client's agent, that agent's aggregate rating, and the client's own
   * review if they have left one. A client who signed up directly has no agent,
   * so `agent` is null and the frontend simply renders nothing.
   */
  async getMyAgent(clientUserId: string): Promise<MyAgentView> {
    const client = await this.users.findOne({ where: { id: clientUserId } });
    if (!client) throw new NotFoundException('User not found');

    const agentId = client.managedByAgentId;
    if (!agentId) {
      return { agent: null, rating: { average: 0, count: 0 }, myReview: null };
    }

    const [agency, rating, mine] = await Promise.all([
      this.agencies.findOne({ where: { ownerUserId: agentId } }),
      this.getRating(agentId),
      this.reviews.findOne({ where: { agentId, userId: clientUserId } }),
    ]);

    return {
      agent: {
        id: agentId,
        agencyName: agency?.agencyName ?? null,
        city: agency?.city ?? null,
        about: agency?.about ?? null,
      },
      rating,
      myReview: mine ? { rating: mine.rating, comment: mine.comment } : null,
    };
  }

  /**
   * Leave or update the client's review of their own agent. Upsert on the
   * (agent, client) pair: a second submission corrects the first rather than
   * stacking a duplicate.
   */
  async submitReview(clientUserId: string, dto: SubmitAgentReviewDto): Promise<MyAgentView> {
    const client = await this.users.findOne({ where: { id: clientUserId } });
    if (!client) throw new NotFoundException('User not found');

    const agentId = client.managedByAgentId;
    if (!agentId) {
      throw new ForbiddenException('You can only review the agent who manages your account');
    }

    const existing = await this.reviews.findOne({ where: { agentId, userId: clientUserId } });
    const comment = dto.comment?.trim() || null;
    if (existing) {
      existing.rating = dto.rating;
      existing.comment = comment;
      await this.reviews.save(existing);
    } else {
      await this.reviews.save(
        this.reviews.create({ agentId, userId: clientUserId, rating: dto.rating, comment }),
      );
    }

    return this.getMyAgent(clientUserId);
  }
}
