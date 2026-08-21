import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispute } from './entities/dispute.entity';
import { Profile } from '../users/entities/profile.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { AgentCharge } from '../agents/entities/agent-charge.entity';
import { VerificationRequest } from '../verification/entities/verification-request.entity';
import { SupportCase } from '../verification/entities/support-case.entity';
import { RaiseDisputeDto, ResolveDisputeDto, UpdateUserStatusDto } from './dto/admin.dto';
import {
  BookingStatus,
  CaseStatus,
  DisputeStatus,
  MatchFixedState,
  PaymentStatus,
  ProfileLifecycle,
  ProviderType,
  UserRole,
  VerificationStatus,
} from '../../common/enums';
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
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(AgentCharge) private readonly charges: Repository<AgentCharge>,
    @InjectRepository(VerificationRequest)
    private readonly verifications: Repository<VerificationRequest>,
    @InjectRepository(SupportCase) private readonly cases: Repository<SupportCase>,
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
  /**
   * The administrator's dashboard.
   *
   * Grouped the way the job is actually done rather than as a flat list of
   * counters: what is waiting on someone (the queues), how the platform is
   * doing at its actual purpose (matches fixed), and where the money currently
   * sits. A number nobody would act on is not on here.
   */
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

    const [
      officers,
      verificationsWaiting,
      verificationsInFlight,
      verificationsApproved,
      casesOpen,
      casesResolved,
    ] = await Promise.all([
      this.users.count({ where: { role: UserRole.IN_PERSON, isActive: true } }),
      this.verifications.count({ where: { status: VerificationStatus.NEW } }),
      this.verifications.count({ where: { status: VerificationStatus.IN_PROGRESS } }),
      this.verifications.count({ where: { status: VerificationStatus.APPROVED } }),
      this.cases.count({ where: { status: CaseStatus.OPEN } }),
      this.cases.count({ where: { status: CaseStatus.RESOLVED } }),
    ]);

    const [profilesActive, profilesUnclaimed, profilesArchived, matchesFixed, matchesPending] =
      await Promise.all([
        this.profiles.count({ where: { lifecycle: ProfileLifecycle.ACTIVE } }),
        this.profiles.count({ where: { userId: IsNull() } }),
        this.profiles.count({ where: { lifecycle: ProfileLifecycle.ARCHIVED } }),
        this.interests.count({ where: { matchFixedState: MatchFixedState.CONFIRMED } }),
        this.interests.count({ where: { matchFixedState: MatchFixedState.PENDING_CONFIRMATION } }),
      ]);

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

      // What is sitting in somebody's queue right now.
      verification: {
        officers,
        // NEW means nobody has been sent to look at it yet, which is the
        // administrator's own backlog rather than an officer's.
        awaitingAllocation: verificationsWaiting,
        inProgress: verificationsInFlight,
        approved: verificationsApproved,
        casesOpen,
        casesResolved,
      },

      // The platform's actual purpose, measured.
      matchmaking: {
        profilesActive,
        profilesUnclaimed,
        profilesArchived,
        matchesFixed,
        // One side has confirmed and is waiting on the other.
        matchesAwaitingConfirmation: matchesPending,
      },

      bookingsByStatus: await this.bookingsByStatus(),
      escrow: await this.escrowPosition(),
    };
  }

  private async bookingsByStatus(): Promise<Record<string, number>> {
    const rows = await this.bookings
      .createQueryBuilder('b')
      .select('b.status', 'status')
      .addSelect('COUNT(b.id)', 'count')
      .groupBy('b.status')
      .getRawMany<{ status: string; count: string }>();

    const out: Record<string, number> = {};
    for (const status of Object.values(BookingStatus)) out[status] = 0;
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  }

  /**
   * Where the money is. Held and disputed are the two that matter: the first is
   * what the platform owes onwards, the second is what it cannot move until
   * somebody decides.
   */
  private async escrowPosition() {
    const sum = async (
      repo: Repository<Payment> | Repository<AgentCharge>,
      status: PaymentStatus,
      column: 'amount' | 'payoutAmount' | 'commissionAmount',
    ): Promise<string> => {
      const row = await (repo as Repository<Payment>)
        .createQueryBuilder('p')
        .select(`COALESCE(SUM(p."${column}"), 0)`, 'total')
        .where('p.status = :status', { status })
        .getRawOne<{ total: string }>();
      return Number(row?.total ?? 0).toFixed(2);
    };

    return {
      bookings: {
        held: await sum(this.payments, PaymentStatus.HELD_IN_ESCROW, 'amount'),
        disputed: await sum(this.payments, PaymentStatus.DISPUTED, 'amount'),
        released: await sum(this.payments, PaymentStatus.RELEASED, 'payoutAmount'),
        commission: await sum(this.payments, PaymentStatus.RELEASED, 'commissionAmount'),
        refunded: await sum(this.payments, PaymentStatus.REFUNDED, 'amount'),
      },
      agencyFees: {
        outstanding: await sum(this.charges, PaymentStatus.INITIATED, 'amount'),
        held: await sum(this.charges, PaymentStatus.HELD_IN_ESCROW, 'amount'),
        released: await sum(this.charges, PaymentStatus.RELEASED, 'payoutAmount'),
        commission: await sum(this.charges, PaymentStatus.RELEASED, 'commissionAmount'),
      },
    };
  }

  private async invalidateListingCaches(): Promise<void> {
    for (const pattern of ['vendors:search:*', 'planners:search:*']) {
      const keys = await this.redis.raw.keys(pattern);
      if (keys.length) await this.redis.del(...keys);
    }
  }
}
