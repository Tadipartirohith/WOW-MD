import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Vendor } from './entities/vendor.entity';
import { VendorReview } from './entities/vendor-review.entity';
import { CreateReviewDto, CreateVendorDto, VendorSearchDto } from './dto/vendor.dto';
import { RedisService } from '../../platform/redis/redis.service';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class VendorsService {
  constructor(
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(VendorReview) private readonly reviews: Repository<VendorReview>,
    private readonly redis: RedisService,
    private readonly dataSource: DataSource,
  ) {}

  async create(ownerUserId: string, dto: CreateVendorDto): Promise<Vendor> {
    const vendor = await this.vendors.save(this.vendors.create({ ownerUserId, ...dto }));
    await this.invalidateSearchCache();
    return vendor;
  }

  async search(q: VendorSearchDto): Promise<PaginatedResult<Vendor>> {
    const cacheKey = `vendors:search:${q.category ?? 'all'}:${q.city ?? 'all'}:${q.page}:${q.limit}`;
    return this.redis.wrap(cacheKey, 60, async () => {
      const qb = this.vendors
        .createQueryBuilder('v')
        .where('v.isApproved = :approved', { approved: true });
      if (q.category) qb.andWhere('v.category = :category', { category: q.category });
      if (q.city) qb.andWhere('LOWER(v.city) = LOWER(:city)', { city: q.city });
      qb.orderBy('v.ratingAvg', 'DESC')
        .skip((q.page - 1) * q.limit)
        .take(q.limit);
      const [data, total] = await qb.getManyAndCount();
      return paginate(data, total, q.page, q.limit);
    });
  }

  async findOne(id: string): Promise<Vendor> {
    const vendor = await this.vendors.findOne({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  /** Adds/updates a review and recomputes the aggregate rating atomically. */
  async addReview(vendorId: string, userId: string, dto: CreateReviewDto): Promise<Vendor> {
    return this.dataSource.transaction(async (manager) => {
      const vendorRepo = manager.getRepository(Vendor);
      const reviewRepo = manager.getRepository(VendorReview);

      const vendor = await vendorRepo.findOne({ where: { id: vendorId } });
      if (!vendor) throw new NotFoundException('Vendor not found');

      await reviewRepo.upsert(
        { vendorId, userId, rating: dto.rating, comment: dto.comment ?? '' },
        ['vendorId', 'userId'],
      );

      const { avg, count } = await reviewRepo
        .createQueryBuilder('r')
        .select('AVG(r.rating)', 'avg')
        .addSelect('COUNT(r.id)', 'count')
        .where('r.vendorId = :vendorId', { vendorId })
        .getRawOne();

      vendor.ratingAvg = Math.round(Number(avg) * 100) / 100;
      vendor.ratingCount = Number(count);
      const saved = await vendorRepo.save(vendor);
      await this.invalidateSearchCache();
      return saved;
    });
  }

  private async invalidateSearchCache(): Promise<void> {
    const keys = await this.redis.raw.keys('vendors:search:*');
    if (keys.length) await this.redis.del(...keys);
  }
}
