import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Vendor } from './entities/vendor.entity';
import { VendorReview } from './entities/vendor-review.entity';
import {
  CreateReviewDto,
  CreateVendorDto,
  UpdateVendorDto,
  VendorSearchDto,
} from './dto/vendor.dto';
import { RedisService } from '../../platform/redis/redis.service';
import { VerificationService } from '../verification/verification.service';
import { ApplicantType } from '../../common/enums';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class VendorsService {
  constructor(
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(VendorReview) private readonly reviews: Repository<VendorReview>,
    private readonly redis: RedisService,
    private readonly dataSource: DataSource,
    private readonly verification: VerificationService,
  ) {}

  async create(ownerUserId: string, dto: CreateVendorDto): Promise<Vendor> {
    // New listings always start unapproved regardless of what the client sent.
    const vendor = await this.saveListing(
      this.vendors.create({ ...dto, ownerUserId, isApproved: false, ratingAvg: 0, ratingCount: 0 }),
    );

    // Listing puts the vendor in the field-verification queue. Approval is an
    // officer's decision after a visit, not a form submission — the registered
    // address on the listing is the address they go to.
    await this.verification.raise(ApplicantType.VENDOR, ownerUserId, vendor.id);

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
    Object.assign(vendor, dto);
    const saved = await this.saveListing(vendor);
    await this.invalidateSearchCache();
    return saved;
  }

  listOwn(ownerUserId: string): Promise<Vendor[]> {
    return this.vendors.find({ where: { ownerUserId }, order: { createdAt: 'DESC' } });
  }

  async search(q: VendorSearchDto): Promise<PaginatedResult<Vendor>> {
    const cacheKey = `vendors:search:${q.category ?? 'all'}:${q.city ?? 'all'}:${q.minRating ?? 0}:${q.page}:${q.limit}`;
    return this.redis.wrap(cacheKey, 60, async () => {
      const qb = this.vendors
        .createQueryBuilder('v')
        .where('v.isApproved = :approved', { approved: true });
      if (q.category) qb.andWhere('v.category = :category', { category: q.category });
      if (q.city) qb.andWhere('LOWER(v.city) = LOWER(:city)', { city: q.city });
      if (q.minRating !== undefined) {
        qb.andWhere('v."ratingAvg" >= :minRating', { minRating: q.minRating });
      }
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

  /**
   * Adds/updates a review and recomputes the aggregate rating atomically.
   * The caller must already have been verified as having completed a booking
   * with this vendor (see VendorsController) — that check lives in the booking
   * module, which owns the booking history.
   */
  async addReview(vendorId: string, userId: string, dto: CreateReviewDto): Promise<Vendor> {
    return this.dataSource.transaction(async (manager) => {
      const vendorRepo = manager.getRepository(Vendor);
      const reviewRepo = manager.getRepository(VendorReview);

      const vendor = await vendorRepo.findOne({ where: { id: vendorId } });
      if (!vendor) throw new NotFoundException('Vendor not found');
      if (vendor.ownerUserId === userId) {
        throw new ForbiddenException('You cannot review your own listing');
      }

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
