import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlannerProfile } from './entities/planner-profile.entity';
import { PlannerSearchDto, UpsertPlannerProfileDto } from './dto/wedding-planner.dto';
import { RedisService } from '../../platform/redis/redis.service';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { VerificationService } from '../verification/verification.service';
import { ApplicantType } from '../../common/enums';
import { likeEscape } from '../../common/util/like';

@Injectable()
export class WeddingPlannersService {
  constructor(
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    private readonly redis: RedisService,
    private readonly verification: VerificationService,
  ) {}

  /**
   * One listing per planner account: upsert on ownerUserId rather than insert,
   * so a planner cannot spam the directory with duplicate profiles.
   */
  async upsertOwn(ownerUserId: string, dto: UpsertPlannerProfileDto): Promise<PlannerProfile> {
    let profile = await this.planners.findOne({ where: { ownerUserId } });
    if (!profile) {
      profile = this.planners.create({ ownerUserId, isApproved: false });
    } else if (!profile.isApproved) {
      // A rejected planner cannot edit-and-resubmit its way back into review
      // (EZ1-I66, EZ1-I72). Checked before mutating so a refused resubmit leaves
      // the saved listing untouched.
      await this.verification.assertNotRejected(ownerUserId, profile.id);
    }
    Object.assign(profile, dto);
    const saved = await this.planners.save(profile);

    /*
     * Saving the listing is what puts a planner in front of an administrator.
     *
     * Nothing did this before, so the screen said "pending administrator
     * review" and no administrator was ever shown anything to review — the
     * planner sat at that step permanently with no way forward and nobody to
     * ask. `raise` is idempotent per subject, so editing the listing again does
     * not queue a second visit.
     *
     * Only while unapproved: an approved planner editing their prices is not
     * asking to be verified again.
     */
    if (!saved.isApproved) {
      await this.verification.raise(ApplicantType.PLANNER, ownerUserId, saved.id, saved.agencyName);
    }

    await this.invalidateSearchCache();
    return saved;
  }

  async getOwn(ownerUserId: string): Promise<PlannerProfile> {
    const profile = await this.planners.findOne({ where: { ownerUserId } });
    if (!profile) throw new NotFoundException('You have not created a planner listing yet');
    return profile;
  }

  /**
   * Where escrow pays this planner out to.
   *
   * `planner_profiles.payoutAccountId` has existed since the planner became a
   * provider, and `bookings.service` reads it to decide where a completed
   * booking's money goes -- but nothing could ever write it. The vendor had a
   * route and a form; the planner had the column, the read, and no way in, so
   * every completed planner booking sat at PENDING_PAYOUT and the retry sweep
   * skipped it on every run for want of an account id (council round 2).
   *
   * An empty string clears it, matching the vendor route: a provider whose
   * account has closed stops payouts going somewhere that will bounce.
   */
  async setPayoutAccount(ownerUserId: string, payoutAccountId: string): Promise<PlannerProfile> {
    const profile = await this.getOwn(ownerUserId);
    profile.payoutAccountId = payoutAccountId.trim() || null;
    return this.planners.save(profile);
  }

  /** Resolves the listing a booking points at, and its owner. */
  async findByIdOrFail(id: string): Promise<PlannerProfile> {
    const profile = await this.planners.findOne({ where: { id } });
    if (!profile) throw new NotFoundException('Planner not found');
    return profile;
  }

  async search(q: PlannerSearchDto): Promise<PaginatedResult<PlannerProfile>> {
    const cacheKey = `planners:search:${q.city ?? 'all'}:${q.minRating ?? 0}:${q.page}:${q.limit}`;
    return this.redis.wrap(cacheKey, 60, async () => {
      const qb = this.planners
        .createQueryBuilder('p')
        .where('p."isApproved" = :approved', { approved: true });
      if (q.city) {
        // Same partial match as the vendor search, for the same reason: this
        // was an equality, so a half-typed city found nobody. The serves-cities
        // array stays an exact containment check — that is a list the planner
        // chose from, not something a client types.
        qb.andWhere('(p.city ILIKE :cityLike OR p."servesCities" @> :cityJson)', {
          cityLike: `%${likeEscape(q.city)}%`,
          cityJson: JSON.stringify([q.city]),
        });
      }
      if (q.minRating !== undefined) {
        qb.andWhere('p."ratingAvg" >= :minRating', { minRating: q.minRating });
      }
      qb.orderBy('p."ratingAvg"', 'DESC')
        .skip((q.page - 1) * q.limit)
        .take(q.limit);
      const [data, total] = await qb.getManyAndCount();
      return paginate(data, total, q.page, q.limit);
    });
  }

  async findOne(id: string): Promise<PlannerProfile> {
    const profile = await this.planners.findOne({ where: { id, isApproved: true } });
    if (!profile) throw new NotFoundException('Planner not found');
    return profile;
  }

  async approve(id: string): Promise<PlannerProfile> {
    const profile = await this.findByIdOrFail(id);
    profile.isApproved = true;
    const saved = await this.planners.save(profile);
    await this.invalidateSearchCache();
    return saved;
  }

  listPending(): Promise<PlannerProfile[]> {
    return this.planners.find({ where: { isApproved: false }, order: { createdAt: 'ASC' } });
  }

  private async invalidateSearchCache(): Promise<void> {
    const keys = await this.redis.raw.keys('planners:search:*');
    if (keys.length) await this.redis.del(...keys);
  }
}
