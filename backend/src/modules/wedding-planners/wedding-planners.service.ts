import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlannerProfile } from './entities/planner-profile.entity';
import { PlannerSearchDto, UpsertPlannerProfileDto } from './dto/wedding-planner.dto';
import { RedisService } from '../../platform/redis/redis.service';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class WeddingPlannersService {
  constructor(
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    private readonly redis: RedisService,
  ) {}

  /**
   * One listing per planner account: upsert on ownerUserId rather than insert,
   * so a planner cannot spam the directory with duplicate profiles.
   */
  async upsertOwn(ownerUserId: string, dto: UpsertPlannerProfileDto): Promise<PlannerProfile> {
    let profile = await this.planners.findOne({ where: { ownerUserId } });
    if (!profile) {
      profile = this.planners.create({ ownerUserId, isApproved: false });
    }
    Object.assign(profile, dto);
    const saved = await this.planners.save(profile);
    await this.invalidateSearchCache();
    return saved;
  }

  async getOwn(ownerUserId: string): Promise<PlannerProfile> {
    const profile = await this.planners.findOne({ where: { ownerUserId } });
    if (!profile) throw new NotFoundException('You have not created a planner listing yet');
    return profile;
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
        qb.andWhere('(LOWER(p.city) = LOWER(:city) OR p."servesCities" @> :cityJson)', {
          city: q.city,
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
