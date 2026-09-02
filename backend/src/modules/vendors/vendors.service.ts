import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Vendor } from './entities/vendor.entity';
import { BusinessLifecycleService } from './business-lifecycle.service';
import { VendorReview } from './entities/vendor-review.entity';
import { User } from '../auth/entities/user.entity';
import { screenText } from '../../common/util/text-moderation';
import {
  CreateReviewDto,
  CreateVendorDto,
  UpdateVendorDto,
  VendorSearchDto,
} from './dto/vendor.dto';
import { RedisService } from '../../platform/redis/redis.service';
import {
  BusinessStatus,
  ReviewStatus,
  UserRole,
  VendorCategory,
} from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { likeEscape } from '../../common/util/like';

/**
 * One listing, as somebody who is not the vendor may see it.
 *
 * Subtractive rather than additive, and deliberately so: `GET /vendors/:id` and
 * `/vendors/search` are both unauthenticated, and both returned the whole row.
 * That put a vendor's PAN number, GST number, registered address, compliance
 * document links and payout account id in front of anybody who could reach the
 * listing — and the ids come straight out of the public search, so reaching it
 * needed nothing but the URL. The rejection reason went out with them, so a
 * refusal written for the vendor ("the proprietor's licence does not match the
 * premises") was readable by their competitors.
 *
 * Adding fields to a list of what to *hide* is how that happens: the next
 * column somebody adds is public until they remember. This names what a buyer
 * needs to choose a vendor, and nothing reaches the outside world unless it is
 * written here.
 */
export interface PublicVendor {
  id: string;
  name: string;
  category: VendorCategory;
  otherCategory: string | null;
  description: string;
  city: string;
  portfolio: string[];
  ratingAvg: number;
  ratingCount: number;
  /** How a buyer reaches them. Published by the vendor for exactly that. */
  contactPhone: string | null;
  /** Whether the platform has stood behind them, not how it decided to. */
  status: BusinessStatus;
  isApproved: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
}

export function publicVendor(v: Vendor): PublicVendor {
  return {
    id: v.id,
    name: v.name,
    category: v.category,
    otherCategory: v.otherCategory,
    description: v.description,
    city: v.city,
    portfolio: v.portfolio,
    ratingAvg: v.ratingAvg,
    ratingCount: v.ratingCount,
    contactPhone: v.contactPhone,
    status: v.status,
    isApproved: v.isApproved,
    verifiedAt: v.verifiedAt,
    createdAt: v.createdAt,
  };
}

@Injectable()
export class VendorsService {
  constructor(
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(VendorReview) private readonly reviews: Repository<VendorReview>,
    // Only to put a name and an address on a review for the administrator
    // moderating it: deciding in the dark is not deciding.
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly redis: RedisService,
    private readonly dataSource: DataSource,
    private readonly lifecycle: BusinessLifecycleService,
  ) {}

  /**
   * A new listing. It starts as a draft and stays one until it is submitted.
   *
   * This used to raise a field-verification request here, the moment the
   * listing row was written — which put a half-filled draft into the officer's
   * queue and produced the reported deadlock. The officer would visit, write up
   * the findings, recommend approval, and the administrator would be refused
   * with "A draft listing cannot be approved" — because nothing had ever moved
   * the business out of DRAFT. Two systems each behaving correctly on their own
   * and disagreeing about what stage the vendor was at.
   *
   * The request belongs to submission, where `BusinessLifecycleService`
   * already raises it *and* moves the business to PENDING_VERIFICATION in the
   * same step, which is the only place those two facts can be kept in step.
   *
   * The guard itself stays. It was telling the truth.
   */
  async create(ownerUserId: string, dto: CreateVendorDto): Promise<Vendor> {
    // New listings always start unapproved regardless of what the client sent.
    const vendor = await this.saveListing(
      this.vendors.create({ ...dto, ownerUserId, isApproved: false, ratingAvg: 0, ratingCount: 0 }),
    );

    await this.invalidateSearchCache();
    return vendor;
  }

  /**
   * A GST number identifies one business, so the database holds it unique. A
   * clash means someone is registering a second listing under a registration
   * that is already claimed, which is a conflict to report, not a crash.
   */
  private async saveListing(vendor: Vendor): Promise<Vendor> {
    try {
      return await this.vendors.save(vendor);
    } catch (err) {
      const message = (err as { message?: string }).message ?? '';
      if (message.includes('UQ_vendors_gst_number')) {
        throw new ConflictException('That GST number is already registered to a listing on WOW.');
      }
      throw err;
    }
  }

  /** Only the owning vendor account may edit a listing. */
  async update(ownerUserId: string, vendorId: string, dto: UpdateVendorDto): Promise<Vendor> {
    const vendor = await this.vendors.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (vendor.ownerUserId !== ownerUserId) {
      throw new ForbiddenException('This listing does not belong to you');
    }

    // Enforced here, not by hiding a button. A vendor who edits their GST
    // number after an officer has been sent to check it has verified nothing,
    // and a listing that changes after approval is a listing nobody checked.
    this.lifecycle.assertEditable(vendor, 'identity');

    Object.assign(vendor, dto);
    const saved = await this.saveListing(vendor);
    await this.invalidateSearchCache();
    return saved;
  }

  /**
   * Where escrow pays out to.
   *
   * Set by the provider once their payout onboarding has cleared. Until it is,
   * money released from escrow stays there marked as owed rather than being
   * pushed at an account that does not exist — so this is the switch that turns
   * a completed job into an actual payment.
   *
   * An empty string clears it, which is how a provider whose account has been
   * closed stops payouts going somewhere that will bounce.
   */
  async setPayoutAccount(
    ownerUserId: string,
    vendorId: string,
    payoutAccountId: string,
  ): Promise<Vendor> {
    const vendor = await this.vendors.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (vendor.ownerUserId !== ownerUserId) {
      throw new ForbiddenException('This listing does not belong to you');
    }
    vendor.payoutAccountId = payoutAccountId.trim() || null;
    return this.vendors.save(vendor);
  }

  listOwn(ownerUserId: string): Promise<Vendor[]> {
    return this.vendors.find({ where: { ownerUserId }, order: { createdAt: 'DESC' } });
  }

  async search(q: VendorSearchDto): Promise<PaginatedResult<PublicVendor>> {
    const cacheKey = `vendors:search:${q.category ?? 'all'}:${q.city ?? 'all'}:${q.minRating ?? 0}:${q.page}:${q.limit}`;
    return this.redis.wrap(cacheKey, 60, async () => {
      const qb = this.vendors
        .createQueryBuilder('v')
        .where('v.isApproved = :approved', { approved: true });
      if (q.category) qb.andWhere('v.category = :category', { category: q.category });
      /*
       * Typed, not chosen.
       *
       * This was an equality, so it matched only somebody who typed the city
       * exactly — "m" found nothing at all, and the report read that as the
       * search being case-sensitive. It was already case-insensitive; it was
       * simply not a search. A person typing into a box expects the list to
       * narrow as they go, so this matches anywhere in the name.
       *
       * The wildcards in the *input* are escaped: a bare "%" would otherwise
       * match every city on the platform, which is a confusing answer to a
       * search rather than a dangerous one, but still not the answer asked for.
       */
      if (q.city) {
        qb.andWhere('v.city ILIKE :city', { city: `%${likeEscape(q.city)}%` });
      }
      if (q.minRating !== undefined) {
        qb.andWhere('v."ratingAvg" >= :minRating', { minRating: q.minRating });
      }
      qb.orderBy('v.ratingAvg', 'DESC')
        .skip((q.page - 1) * q.limit)
        .take(q.limit);
      const [data, total] = await qb.getManyAndCount();
      return paginate(data.map(publicVendor), total, q.page, q.limit);
    });
  }

  /** The listing as the public sees it. Never the whole row — see PublicVendor. */
  async findOne(id: string): Promise<PublicVendor> {
    return publicVendor(await this.loadOrFail(id));
  }

  /**
   * The whole row, for the one account entitled to it.
   *
   * The vendor's own portal needs what the public view withholds: the
   * compliance details they entered, and — the point of it — the exact reason
   * an officer sent the listing back. A reason the vendor cannot read is a
   * refusal with no instruction in it.
   */
  async findForOwner(actor: AuthUser, id: string): Promise<Vendor> {
    const vendor = await this.loadOrFail(id);
    if (actor.role !== UserRole.ADMIN && vendor.ownerUserId !== actor.userId) {
      throw new ForbiddenException('That business is not yours');
    }
    return vendor;
  }

  private async loadOrFail(id: string): Promise<Vendor> {
    const vendor = await this.vendors.findOne({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  /**
   * Adds/updates a review and recomputes the aggregate rating atomically.
   * The caller must already have been verified as having completed a booking
   * with this vendor (see VendorsController) — that check lives in the booking
   * module, which owns the booking history.
   */
  /**
   * Writes a review against a specific completed booking.
   *
   * Screened before it is published, not instead of being published. An
   * automatic check that refuses is a check that will one day refuse a real
   * complaint about a real vendor — the review with the most reason to exist
   * and the most incentive to disappear — so anything the screen dislikes is
   * held for an administrator with its words kept verbatim.
   */
  /**
   * The reviews on a listing, with the reviewer removed.
   *
   * This is what a vendor and a buyer both see, and the omission is the point:
   * a vendor who knows which customer left three stars is a vendor who can
   * take it up with them, and the prospect of that conversation is what stops
   * the next honest review being written. So no userId, no name, no booking
   * reference — a booking reference identifies a customer perfectly well.
   *
   * Only published rows. A held review is not a secret, it is simply not
   * published yet, and showing it to the vendor before an administrator has
   * read it would defeat the holding.
   */
  async listReviews(vendorId: string): Promise<
    { id: string; rating: number; comment: string; createdAt: Date }[]
  > {
    const rows = await this.reviews.find({
      where: { vendorId, status: ReviewStatus.PUBLISHED },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
    }));
  }

  /** Which of this user's bookings already carry a review, for the eligibility check. */
  async reviewedBookingIds(userId: string, vendorId: string): Promise<string[]> {
    const rows = await this.reviews.find({
      where: { userId, vendorId },
      select: ['bookingId'],
    });
    return rows.map((r) => r.bookingId).filter(Boolean) as string[];
  }

  /**
   * Every review, whoever wrote it, for the administrator.
   *
   * The opposite of the vendor's view on purpose: moderating a review without
   * knowing who wrote it, what it was about and which booking it came from is
   * moderating in the dark, and the decision is theirs to defend.
   */
  async listReviewsForAdmin(filter: { status?: ReviewStatus; vendorId?: string }) {
    const where: Record<string, unknown> = {};
    if (filter.status) where.status = filter.status;
    if (filter.vendorId) where.vendorId = filter.vendorId;

    const rows = await this.reviews.find({
      where,
      order: { createdAt: 'DESC' },
      take: 200,
    });
    if (rows.length === 0) return [];

    const [users, vendors] = await Promise.all([
      this.users.find({
        where: { id: In([...new Set(rows.map((r) => r.userId))]) },
        select: ['id', 'email'],
      }),
      this.vendors.find({
        where: { id: In([...new Set(rows.map((r) => r.vendorId))]) },
        select: ['id', 'name'],
      }),
    ]);
    const byUser = new Map(users.map((u) => [u.id, u.email]));
    const byVendor = new Map(vendors.map((v) => [v.id, v.name]));

    return rows.map((r) => ({
      ...r,
      reviewerEmail: byUser.get(r.userId) ?? null,
      vendorName: byVendor.get(r.vendorId) ?? null,
    }));
  }

  /**
   * The administrator's decision on a review.
   *
   * A reason is required for anything but publishing, because the reason is
   * the only thing that makes the decision reviewable later — by the next
   * administrator, or by the vendor asking why their rating moved.
   */
  async moderateReview(
    actorUserId: string,
    reviewId: string,
    status: ReviewStatus,
    reason: string | null,
  ): Promise<VendorReview> {
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
    await this.dataSource.transaction((m) => this.recountRatings(m, review.vendorId));
    await this.invalidateSearchCache();
    return saved;
  }

  /**
   * The published reviews, and only those.
   *
   * A removed review has to move the average or removing it means nothing —
   * the number is the whole reason anybody reads this page. Held and flagged
   * reviews do not count either: neither has been decided yet.
   */
  private async recountRatings(manager: EntityManager, vendorId: string): Promise<void> {
    const vendorRepo = manager.getRepository(Vendor);
    const reviewRepo = manager.getRepository(VendorReview);

    const { avg, count } = await reviewRepo
      .createQueryBuilder('r')
      .select('AVG(r.rating)', 'avg')
      .addSelect('COUNT(r.id)', 'count')
      .where('r.vendorId = :vendorId', { vendorId })
      .andWhere('r.status = :status', { status: ReviewStatus.PUBLISHED })
      .getRawOne();

    await vendorRepo.update(vendorId, {
      ratingAvg: Math.round(Number(avg ?? 0) * 100) / 100,
      ratingCount: Number(count ?? 0),
    });
  }

  async addReview(
    vendorId: string,
    userId: string,
    bookingId: string | null,
    dto: CreateReviewDto,
  ): Promise<Vendor> {
    return this.dataSource.transaction(async (manager) => {
      const vendorRepo = manager.getRepository(Vendor);
      const reviewRepo = manager.getRepository(VendorReview);

      const vendor = await vendorRepo.findOne({ where: { id: vendorId } });
      if (!vendor) throw new NotFoundException('Vendor not found');
      if (vendor.ownerUserId === userId) {
        throw new ForbiddenException('You cannot review your own listing');
      }

      const verdict = screenText(dto.comment);
      await reviewRepo.save(
        reviewRepo.create({
          vendorId,
          userId,
          bookingId,
          rating: dto.rating,
          comment: dto.comment ?? '',
          status: verdict.hold ? ReviewStatus.UNDER_REVIEW : ReviewStatus.PUBLISHED,
          moderationReason: verdict.reason,
        }),
      );

      await this.recountRatings(manager, vendorId);
      // Re-read so the returned rating reflects the recount above.
      const saved = (await vendorRepo.findOne({ where: { id: vendorId } })) ?? vendor;
      await this.invalidateSearchCache();
      return saved;
    });
  }

  private async invalidateSearchCache(): Promise<void> {
    const keys = await this.redis.raw.keys('vendors:search:*');
    if (keys.length) await this.redis.del(...keys);
  }
}
