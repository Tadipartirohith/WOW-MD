import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispute } from './entities/dispute.entity';
import { RaiseDisputeDto, ResolveDisputeDto } from './dto/admin.dto';
import { DisputeStatus } from '../../common/enums';
import { RedisService } from '../../platform/redis/redis.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Dispute) private readonly disputes: Repository<Dispute>,
    private readonly redis: RedisService,
  ) {}

  listUsers(limit = 50) {
    return this.users.find({ take: limit, order: { createdAt: 'DESC' } });
  }

  listPendingVendors() {
    return this.vendors.find({ where: { isApproved: false }, order: { createdAt: 'ASC' } });
  }

  async approveVendor(vendorId: string) {
    const vendor = await this.vendors.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    vendor.isApproved = true;
    const saved = await this.vendors.save(vendor);
    // Approval changes what public search returns, invalidate the cached lists.
    const keys = await this.redis.raw.keys('vendors:search:*');
    if (keys.length) await this.redis.del(...keys);
    return saved;
  }

  raiseDispute(userId: string, dto: RaiseDisputeDto) {
    return this.disputes.save(
      this.disputes.create({ bookingId: dto.bookingId, raisedBy: userId, reason: dto.reason }),
    );
  }

  listDisputes(status?: DisputeStatus) {
    return this.disputes.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async resolveDispute(id: string, dto: ResolveDisputeDto) {
    const dispute = await this.disputes.findOne({ where: { id } });
    if (!dispute) throw new NotFoundException('Dispute not found');
    dispute.status = dto.status;
    dispute.resolution = dto.resolution ?? '';
    return this.disputes.save(dispute);
  }

  /** Analytics dashboard counters. */
  async analytics() {
    const [totalUsers, totalVendors, pendingVendors, totalBookings, openDisputes] =
      await Promise.all([
        this.users.count(),
        this.vendors.count(),
        this.vendors.count({ where: { isApproved: false } }),
        this.bookings.count(),
        this.disputes.count({ where: { status: DisputeStatus.OPEN } }),
      ]);
    return { totalUsers, totalVendors, pendingVendors, totalBookings, openDisputes };
  }
}
