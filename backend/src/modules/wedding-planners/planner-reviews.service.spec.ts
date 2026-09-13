import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PlannerReviewsService } from './planner-reviews.service';
import { PlannerProfile } from './entities/planner-profile.entity';
import { PlannerReview } from './entities/planner-review.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { RedisService } from '../../platform/redis/redis.service';
import { ReviewStatus } from '../../common/enums';

const review = (over: Partial<PlannerReview> = {}): PlannerReview =>
  ({
    id: 'r1',
    plannerId: 'p1',
    userId: 'u1',
    bookingId: 'b1',
    rating: 5,
    comment: 'They ran the whole day.',
    categories: {},
    status: ReviewStatus.PUBLISHED,
    moderationReason: null,
    moderatedByUserId: null,
    moderatedAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  }) as PlannerReview;

describe('PlannerReviewsService', () => {
  let service: PlannerReviewsService;
  let rows: PlannerReview[] = [];
  let planner: PlannerProfile;
  /** What the recount wrote onto the listing. */
  let rated: { ratingAvg: number; ratingCount: number } | null = null;

  const reviewsRepo = {
    find: jest.fn(async () => rows),
    findOne: jest.fn(async () => rows[0] ?? null),
    save: jest.fn(async (row: PlannerReview) => row),
  };
  const plannersRepo = {
    find: jest.fn(async () => [planner]),
    findOne: jest.fn(async () => planner),
    update: jest.fn(async (_id: string, patch: { ratingAvg: number; ratingCount: number }) => {
      rated = patch;
    }),
  };
  const bare = { find: jest.fn(async () => []), findOne: jest.fn(async () => null) };

  /*
   * A transaction that hands back the same stubs, so the write path can be
   * exercised without a database. The recount reads through a query builder,
   * which is stubbed to the average of whatever is published in `rows`.
   */
  const dataSource = {
    transaction: jest.fn(async (work: (m: unknown) => Promise<unknown>) =>
      work({
        getRepository: (entity: unknown) =>
          entity === PlannerProfile
            ? plannersRepo
            : {
                ...reviewsRepo,
                create: (x: Partial<PlannerReview>) => x as PlannerReview,
                save: async (x: PlannerReview) => {
                  rows = [...rows, x];
                  return x;
                },
                createQueryBuilder: () => {
                  const published = rows.filter((r) => r.status === ReviewStatus.PUBLISHED);
                  const avg = published.length
                    ? published.reduce((t, r) => t + r.rating, 0) / published.length
                    : null;
                  const builder = {
                    select: () => builder,
                    addSelect: () => builder,
                    where: () => builder,
                    andWhere: () => builder,
                    getRawOne: async () => ({ avg, count: published.length }),
                  };
                  return builder;
                },
              },
      }),
    ),
  } as unknown as DataSource;

  const redis = { raw: { keys: jest.fn(async () => []) }, del: jest.fn() } as unknown as RedisService;

  beforeEach(async () => {
    jest.clearAllMocks();
    rows = [];
    rated = null;
    planner = { id: 'p1', ownerUserId: 'planner-owner', agencyName: 'Sharma Weddings' } as PlannerProfile;

    const moduleRef = await Test.createTestingModule({
      providers: [
        PlannerReviewsService,
        { provide: getRepositoryToken(PlannerReview), useValue: reviewsRepo },
        { provide: getRepositoryToken(PlannerProfile), useValue: plannersRepo },
        { provide: getRepositoryToken(Booking), useValue: bare },
        { provide: getRepositoryToken(User), useValue: bare },
        { provide: getRepositoryToken(Profile), useValue: bare },
        { provide: DataSource, useValue: dataSource },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    service = moduleRef.get(PlannerReviewsService);
  });

  describe('the summary', () => {
    it('answers zero rather than nothing for a planner with no reviews', async () => {
      const summary = await service.summary('p1');
      expect(summary).toEqual({
        average: 0,
        total: 0,
        breakdown: { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 },
        categories: {},
      });
    });

    it('averages the stored ratings and counts each star', async () => {
      rows = [review({ rating: 5 }), review({ rating: 4 }), review({ rating: 4 })];
      const summary = await service.summary('p1');
      expect(summary.average).toBeCloseTo(4.33, 2);
      expect(summary.total).toBe(3);
      expect(summary.breakdown['4']).toBe(2);
      expect(summary.breakdown['5']).toBe(1);
    });

    /*
     * The categories are optional, and a skipped one is not a zero. Counting it
     * as one would mark a planner down for a question nobody was made to
     * answer.
     */
    it('averages a category over the reviews that scored it', async () => {
      rows = [
        review({ categories: { communication: 5, timeliness: 3 } }),
        review({ categories: { communication: 3 } }),
        review({ categories: {} }),
      ];
      const summary = await service.summary('p1');
      expect(summary.categories.communication).toBe(4);
      expect(summary.categories.timeliness).toBe(3);
      expect(summary.categories.professionalism).toBeUndefined();
    });
  });

  describe('writing one', () => {
    it('stores the rating, the words and only the categories that were answered', async () => {
      await service.add('p1', 'u1', 'b1', {
        rating: 5,
        comment: 'Faultless.',
        communication: 4,
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].rating).toBe(5);
      expect(rows[0].categories).toEqual({ communication: 4 });
      expect(rows[0].status).toBe(ReviewStatus.PUBLISHED);
    });

    it('moves the listing average, which is the number everybody reads', async () => {
      await service.add('p1', 'u1', 'b1', { rating: 4 });
      expect(rated).toEqual({ ratingAvg: 4, ratingCount: 1 });
    });

    it('refuses a planner reviewing their own listing', async () => {
      await expect(
        service.add('p1', 'planner-owner', 'b1', { rating: 5 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('moderation', () => {
    it('insists on a reason for anything but publishing', async () => {
      rows = [review()];
      await expect(
        service.moderate('admin-1', 'r1', ReviewStatus.REMOVED, '   '),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('records who decided and when, and recounts the rating', async () => {
      rows = [review()];
      const saved = await service.moderate('admin-1', 'r1', ReviewStatus.REMOVED, 'Abusive');
      expect(saved.status).toBe(ReviewStatus.REMOVED);
      expect(saved.moderatedByUserId).toBe('admin-1');
      expect(saved.moderatedAt).toBeInstanceOf(Date);
      // Removing a review that leaves the average untouched has not removed
      // anything.
      expect(rated).toEqual({ ratingAvg: 0, ratingCount: 0 });
    });

    it('publishes without a reason', async () => {
      rows = [review({ status: ReviewStatus.UNDER_REVIEW })];
      const saved = await service.moderate('admin-1', 'r1', ReviewStatus.PUBLISHED, null);
      expect(saved.status).toBe(ReviewStatus.PUBLISHED);
    });
  });
});
