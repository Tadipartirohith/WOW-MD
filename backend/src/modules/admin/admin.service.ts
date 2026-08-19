import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispute } from './entities/dispute.entity';
import { RaiseDisputeDto, ResolveDisputeDto, UpdateUserStatusDto } from './dto/admin.dto';
import { DisputeStatus, ProviderType, UserRole } from '../../common/enums';
import { RedisService } from '../../platform/redis/redis.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

/** Admin-facing user row. Excludes hash columns by explicit projection. */
export interface AdminUserView {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  isVerified: boolean;
  managedByAgentId: string | null;
  createdAt: Date;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Dispute) private readonly disputes: Repository<Dispute>,
    private readonly redis: RedisService,
  ) {}

  async listUsers(page: number, limit: number, role?: UserRole): Promise<PaginatedResult<AdminUserView>> {
    const [rows, total] = await this.users.findAndCount({
      where: role ? { role } : {},
      select: ['id', 'email', 'role', 'isActive', 'isVerified', 'managedByAgentId', 'createdAt'],
      take: limit,
      skip: (page - 1) * limit,
      order: { createdAt: 'DESC' },
    });
    return paginate(rows as AdminUserView[], total, page, limit);
  }

  async setUserStatus(id: string, dto: UpdateUserStatusDto): Promise<AdminUserView> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    user.isActive = dto.isActive;
    await this.users.save(user);
    const { passwordHash, refreshTokenHash, ...safe } = user as User & Record<string, unknown>;
    void passwordHash;
    void refreshTokenHash;
    return safe as unknown as AdminUserView;
  }

  listPendingVendors() {
    return this.vendors.find({ where: { isApproved: false }, order: { createdAt: 'ASC' } });
  }

  listPendingPlanners() {
    return this.planners.find({ where: { isApproved: false }, order: { createdAt: 'ASC' } });
  }

  async approveVendor(vendorId: string) {
    const vendor = await this.vendors.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    vendor.isApproved = true;
    const saved = await this.vendors.save(vendor);
    await this.invalidateListingCaches();
    return saved;
  }

  async approvePlanner(plannerId: string) {
    const planner = await this.planners.findOne({ where: { id: plannerId } });
    if (!planner) throw new NotFoundException('Planner not found');
    planner.isApproved = true;
    const saved = await this.planners.save(planner);
    await this.invalidateListingCaches();
    return saved;
  }

  /**
   * A dispute may only be raised by someone party to the booking: the client,
   * the agent who placed it, or the provider whose listing was booked.
   */
  async raiseDispute(actor: AuthUser, dto: RaiseDisputeDto) {
    const booking = await this.bookings.findOne({ where: { id: dto.bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');

    const isBuyer = booking.userId === actor.userId || booking.bookedByUserId === actor.userId;
    let isSeller = false;
    if (!isBuyer) {
      if (booking.providerType === ProviderType.VENDOR) {
        const vendor = await this.vendors.findOne({ where: { id: booking.providerId } });
        isSeller = vendor?.ownerUserId === actor.userId;
      } else {
        const planner = await this.planners.findOne({ where: { id: booking.providerId } });
        isSeller = planner?.ownerUserId === actor.userId;
      }
    }
    if (!isBuyer && !isSeller && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('You are not party to that booking');
    }

    return this.disputes.save(
      this.disputes.create({
        bookingId: dto.bookingId,
        raisedBy: actor.userId,
        reason: dto.reason,
      }),
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
    const [
      totalUsers,
      totalVendors,
      pendingVendors,
      totalPlanners,
      pendingPlanners,
      totalAgents,
      totalBookings,
      openDisputes,
    ] = await Promise.all([
      this.users.count(),
      this.vendors.count(),
      this.vendors.count({ where: { isApproved: false } }),
      this.planners.count(),
      this.planners.count({ where: { isApproved: false } }),
      this.users.count({ where: { role: UserRole.AGENT } }),
      this.bookings.count(),
      this.disputes.count({ where: { status: DisputeStatus.OPEN } }),
    ]);

    const usersByRole = await this.users
      .createQueryBuilder('u')
      .select('u.role', 'role')
      .addSelect('COUNT(u.id)', 'count')
      .groupBy('u.role')
      .getRawMany<{ role: string; count: string }>();

    return {
      totalUsers,
      totalVendors,
      pendingVendors,
      totalPlanners,
      pendingPlanners,
      totalAgents,
      totalBookings,
      openDisputes,
      usersByRole: usersByRole.map((r) => ({ role: r.role, count: Number(r.count) })),
    };
  }

  private async invalidateListingCaches(): Promise<void> {
    for (const pattern of ['vendors:search:*', 'planners:search:*']) {
      const keys = await this.redis.raw.keys(pattern);
      if (keys.length) await this.redis.del(...keys);
    }
  }
}
