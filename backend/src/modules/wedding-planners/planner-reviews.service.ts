import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, ILike, In, Repository } from 'typeorm';
import { PlannerProfile } from './entities/planner-profile.entity';
import {
  PLANNER_REVIEW_CATEGORIES,
  PlannerReview,
  type PlannerReviewCategory,
} from './entities/planner-review.entity';
import { CreatePlannerReviewDto } from './dto/wedding-planner.dto';
import { Booking } from '../bookings/entities/booking.entity';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { ReviewStatus } from '../../common/enums';
import { screenText } from '../../common/util/text-moderation';
import { RedisService } from '../../platform/redis/redis.service';

/** What a planner's page shows above the list: the average and the shape of it. */
export interface PlannerRatingSummary {
  average: number;
  total: number;
  /** How many reviews gave each star, 5 down to 1. */
  breakdown: Record<string, number>;
  /** Averages for the parts of the job couples rated separately. */
  categories: Record<string, number>;
}

/**
 * Reviews and ratings for wedding planners (EZ1-I244).
 *
 * The vendor review system, for the other kind of provider, and deliberately
 * the same rules rather than a second opinion about them:
 *
 *  - only a completed booking earns a review, and one booking earns one;
 *  - the average counts published reviews only, so moderating one moves it;
 *  - the planner never learns who wrote which, because a planner who can work
 *    out which couple left three stars can take it up with them.
 *
 * Its own service rather than more of WeddingPlannersService: that file is the
 * listing — search, approval, payouts — and this is a different lifecycle with
 * a different audience.
 */
@Injectable()
export class PlannerReviewsService {
  constructor(
    @InjectRepository(PlannerReview) private readonly reviews: Repository<PlannerReview>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
  ) {}

  // ------------------------------------------------------------------ read --

  /**
   * What people said, with who said it left out.
   *
   * Public, and identical for a couple browsing and for the planner being
   * reviewed. No name, no id, and no booking reference either — a booking
   * reference identifies a customer perfectly well.
   */
  async listPublished(plannerId: string): Promise<
    { id: string; rating: number; comment: string; categories: Record<string, number>; createdAt: Date }[]
  > {
    const rows = await this.reviews.find({
      where: { plannerId, status: ReviewStatus.PUBLISHED },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      categories: r.categories ?? {},
      createdAt: r.createdAt,
    }));
  }

  /** The average, the count and the star breakdown, from the stored reviews. */
  async summary(plannerId: string): Promise<PlannerRatingSummary> {
    const rows = await this.reviews.find({
      where: { plannerId, status: ReviewStatus.PUBLISHED },
      select: ['rating', 'categories'],
    });

    const breakdown: Record<string, number> = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };
    let sum = 0;
    for (const row of rows) {
      sum += row.rating;
      const key = String(row.rating);
      if (key in breakdown) breakdown[key] += 1;
    }

    // A category average counts only the reviews that scored that category.
    // Treating a skipped one as a zero would punish a planner for a question
    // nobody was made to answer.
    const categories: Record<string, number> = {};
    for (const category of PLANNER_REVIEW_CATEGORIES) {
      const scored = rows
        .map((row) => Number(row.categories?.[category] ?? 0))
        .filter((value) => value > 0);
      if (scored.length) {
        categories[category] =
          Math.round((scored.reduce((t, v) => t + v, 0) / scored.length) * 100) / 100;
      }
    }

    return {
      average: rows.length ? Math.round((sum / rows.length) * 100) / 100 : 0,
      total: rows.length,
      breakdown,
      categories,
    };
  }

  /**
   * The planner's own reviews, enriched with the booking each is about.
   *
   * The reviewer is still left out — no name and no contact — so the planner
   * cannot trace a rating back to a couple.
   */
  async listForOwner(
    ownerUserId: string,
    plannerId: string,
  ): Promise<{
    summary: PlannerRatingSummary;
    reviews: {
      id: string;
      rating: number;
      comment: string;
      categories: Record<string, number>;
      createdAt: Date;
      bookingId: string | null;
      eventDate: string | null;
    }[];
  }> {
    const planner = await this.planners.findOne({ where: { id: plannerId } });
    if (!planner) throw new NotFoundException('Listing not found');
    if (planner.ownerUserId !== ownerUserId) {
      throw new ForbiddenException('This listing does not belong to you');
    }

    const rows = await this.reviews.find({
      where: { plannerId, status: ReviewStatus.PUBLISHED },
      order: { createdAt: 'DESC' },
      take: 100,
    });

    const bookingIds = [...new Set(rows.map((r) => r.bookingId).filter(Boolean))] as string[];
    const bookings = bookingIds.length
      ? await this.bookings.find({ where: { id: In(bookingIds) } })
      : [];
    const byId = new Map(bookings.map((b) => [b.id, b]));

    return {
      summary: await this.summary(plannerId),
      reviews: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        categories: r.categories ?? {},
        createdAt: r.createdAt,
        bookingId: r.bookingId,
        eventDate: r.bookingId ? (byId.get(r.bookingId)?.eventDate ?? null) : null,
      })),
    };
  }

  /** Which of this user's planner bookings already carry a review. */
  async reviewedBookingIds(userId: string, plannerId: string): Promise<string[]> {
    const rows = await this.reviews.find({
      where: { userId, plannerId },
      select: ['bookingId'],
    });
    return rows.map((r) => r.bookingId).filter(Boolean) as string[];
  }

  // ----------------------------------------------------------------- write --

  async add(
    plannerId: string,
    userId: string,
    bookingId: string | null,
    dto: CreatePlannerReviewDto,
  ): Promise<PlannerProfile> {
    return this.dataSource.transaction(async (manager) => {
      const plannerRepo = manager.getRepository(PlannerProfile);
      const reviewRepo = manager.getRepository(PlannerReview);

      const planner = await plannerRepo.findOne({ where: { id: plannerId } });
      if (!planner) throw new NotFoundException('Planner not found');
      if (planner.ownerUserId === userId) {
        throw new ForbiddenException('You cannot review your own listing');
      }

      const verdict = screenText(dto.comment);
      await reviewRepo.save(
        reviewRepo.create({
          plannerId,
          userId,
          bookingId,
          rating: dto.rating,
          comment: dto.comment ?? '',
          categories: categoriesOf(dto),
          status: verdict.hold ? ReviewStatus.UNDER_REVIEW : ReviewStatus.PUBLISHED,
          moderationReason: verdict.reason,
        }),
      );

      await this.recount(manager, plannerId);
      // Re-read so the returned rating reflects the recount above.
      const saved = (await plannerRepo.findOne({ where: { id: plannerId } })) ?? planner;
      await this.invalidateSearchCache();
      return saved;
    });
  }

  async moderate(
    actorUserId: string,
    reviewId: string,
    status: ReviewStatus,
    reason: string | null,
  ): Promise<PlannerReview> {
    const review = await this.reviews.findOne({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');

    if (status !== ReviewStatus.PUBLISHED && !reason?.trim()) {
      throw new BadRequestException('Say why. A decision with no reason cannot be reviewed later.');
    }

    review.status = status;
    review.moderationReason = reason?.trim() || null;
    review.moderatedByUserId = actorUserId;
    review.moderatedAt = new Date();
    const saved = await this.reviews.save(review);

    // The rating follows the decision. Removing a review that leaves the
    // average untouched has not removed anything.
    await this.dataSource.transaction((m) => this.recount(m, review.plannerId));
    await this.invalidateSearchCache();
    return saved;
  }

  // ----------------------------------------------------------------- admin --

  /**
   * Every review, whoever wrote it, for the administrator.
   *
   * The opposite of the planner's view on purpose: moderating a review without
   * knowing who wrote it, about whom, and which booking it came from is
   * moderating in the dark, and the decision is theirs to defend.
   */
  async listForAdmin(filter: {
    status?: ReviewStatus;
    plannerId?: string;
    rating?: number;
    q?: string;
  }) {
    const where: Record<string, unknown> = {};
    if (filter.status) where.status = filter.status;
    if (filter.plannerId) where.plannerId = filter.plannerId;
    if (filter.rating) where.rating = filter.rating;

    const rows = await this.reviews.find({
      where,
      order: { createdAt: 'DESC' },
      take: 200,
    });
    if (rows.length === 0) return [];

    const [users, planners, names] = await Promise.all([
      this.users.find({
        where: { id: In([...new Set(rows.map((r) => r.userId))]) },
        select: ['id', 'email'],
      }),
      this.planners.find({ where: { id: In([...new Set(rows.map((r) => r.plannerId))]) } }),
      this.profiles.find({
        where: { userId: In([...new Set(rows.map((r) => r.userId))]) },
        select: ['userId', 'displayName'],
      }),
    ]);
    const emailById = new Map(users.map((u) => [u.id, u.email]));
    const plannerById = new Map(planners.map((p) => [p.id, p]));
    const nameById = new Map(names.map((p) => [p.userId as string, p.displayName]));

    const enriched = rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      categories: r.categories ?? {},
      status: r.status,
      moderationReason: r.moderationReason,
      moderatedAt: r.moderatedAt,
      createdAt: r.createdAt,
      bookingId: r.bookingId,
      plannerId: r.plannerId,
      plannerName: plannerById.get(r.plannerId)?.agencyName ?? null,
      userId: r.userId,
      userEmail: emailById.get(r.userId) ?? null,
      userName: nameById.get(r.userId) ?? null,
    }));

    // The search box, applied last so it can reach the names and the email the
    // rows above resolved. One box, because an administrator looking for "the
    // complaint about Sharma" does not know which field it is in.
    const term = filter.q?.trim().toLowerCase();
    if (!term) return enriched;
    return enriched.filter((row) =>
      [row.plannerName, row.userEmail, row.userName, row.comment, row.bookingId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }

  /** Planners an administrator can filter by, for the moderation page. */
  async plannerOptions(): Promise<{ id: string; agencyName: string }[]> {
    const rows = await this.planners.find({
      where: { agencyName: ILike('%') },
      select: ['id', 'agencyName'],
      order: { agencyName: 'ASC' },
      take: 500,
    });
    return rows.map((r) => ({ id: r.id, agencyName: r.agencyName }));
  }

  // --------------------------------------------------------------- private --

  private async recount(manager: EntityManager, plannerId: string): Promise<void> {
    const plannerRepo = manager.getRepository(PlannerProfile);
    const reviewRepo = manager.getRepository(PlannerReview);

    const { avg, count } = await reviewRepo
      .createQueryBuilder('r')
      .select('AVG(r.rating)', 'avg')
      .addSelect('COUNT(r.id)', 'count')
      .where('r.plannerId = :plannerId', { plannerId })
      .andWhere('r.status = :status', { status: ReviewStatus.PUBLISHED })
      .getRawOne();

    await plannerRepo.update(plannerId, {
      ratingAvg: Math.round(Number(avg ?? 0) * 100) / 100,
      ratingCount: Number(count ?? 0),
    });
  }

  private async invalidateSearchCache(): Promise<void> {
    const keys = await this.redis.raw.keys('planners:search:*');
    if (keys.length) await this.redis.del(...keys);
  }
}

/** The five optional scores, with anything unanswered left out entirely. */
function categoriesOf(dto: CreatePlannerReviewDto): Record<string, number> {
  const out: Record<string, number> = {};
  for (const category of PLANNER_REVIEW_CATEGORIES) {
    const value = dto[category as PlannerReviewCategory];
    if (typeof value === 'number') out[category] = value;
  }
  return out;
}
