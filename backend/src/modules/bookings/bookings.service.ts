import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { Payment } from './entities/payment.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { BookingSearchDto, CreateBookingDto } from './dto/booking.dto';
import {
  BookingStatus,
  PaymentStatus,
  ProviderType,
  UserRole,
  isConsumer,
} from '../../common/enums';
import { AppConfigService } from '../../config/app-config.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment.provider';
import { AgentsService } from '../agents/agents.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

/**
 * Booking lifecycle + escrow, implemented as an explicit state machine:
 *   REQUESTED -(buyer pays)-> PENDING[escrow held]
 *             -(provider confirms)-> CONFIRMED
 *             -(provider completes)-> COMPLETED[escrow released]
 *   any -> CANCELLED[escrow refunded]
 */
const ALLOWED: Record<BookingStatus, BookingStatus[]> = {
  [BookingStatus.REQUESTED]: [BookingStatus.PENDING, BookingStatus.CANCELLED],
  [BookingStatus.PENDING]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
  [BookingStatus.CONFIRMED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.CANCELLED]: [],
};

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    private readonly cfg: AppConfigService,
    private readonly outbox: OutboxService,
    private readonly dataSource: DataSource,
    private readonly agents: AgentsService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly gateway: PaymentProvider,
  ) {}

  /**
   * Splits an escrow amount into the platform's commission and the provider's
   * payout. PAYMENT_COMMISSION_PERCENT was previously read into config and
   * never applied, so providers received the gross amount and the marketplace
   * earned nothing.
   *
   * Rounding favours the provider: the commission is floored to whole paise so
   * the two parts always sum back to exactly the amount held.
   */
  splitAmount(amount: string): { commission: string; payout: string } {
    const gross = Math.round(parseFloat(amount) * 100); // work in minor units
    const percent = this.cfg.payments.commissionPercent;
    const commission = Math.floor((gross * percent) / 100);
    const payout = gross - commission;
    return {
      commission: (commission / 100).toFixed(2),
      payout: (payout / 100).toFixed(2),
    };
  }

  /** Resolves the user account that owns the provider listing on a booking. */
  private async providerOwner(
    providerType: ProviderType,
    providerId: string,
    manager?: EntityManager,
  ): Promise<{ ownerUserId: string; isApproved: boolean }> {
    if (providerType === ProviderType.VENDOR) {
      const repo = manager ? manager.getRepository(Vendor) : this.vendors;
      const vendor = await repo.findOne({ where: { id: providerId } });
      if (!vendor) throw new NotFoundException('Vendor not found');
      return { ownerUserId: vendor.ownerUserId, isApproved: vendor.isApproved };
    }
    const repo = manager ? manager.getRepository(PlannerProfile) : this.planners;
    const planner = await repo.findOne({ where: { id: providerId } });
    if (!planner) throw new NotFoundException('Planner not found');
    return { ownerUserId: planner.ownerUserId, isApproved: planner.isApproved };
  }

  /**
   * Creates a booking. Only consumer personas reach this (enforced by the
   * permission guard); the extra checks here cover who the booking is *for*.
   */
  async create(actor: AuthUser, dto: CreateBookingDto): Promise<Booking> {
    if (!isConsumer(actor.role)) {
      throw new ForbiddenException('Only individual users and agents can place bookings');
    }

    let clientUserId = actor.userId;
    if (dto.onBehalfOfUserId && dto.onBehalfOfUserId !== actor.userId) {
      if (actor.role !== UserRole.AGENT) {
        throw new ForbiddenException('Only agents can book on behalf of another account');
      }
      // Throws unless the target is a live client on this agent's books.
      await this.agents.assertManages(actor.userId, dto.onBehalfOfUserId);
      clientUserId = dto.onBehalfOfUserId;
    }

    const provider = await this.providerOwner(dto.providerType, dto.providerId);
    if (!provider.isApproved) {
      throw new BadRequestException('That provider is not yet approved for bookings');
    }
    if (provider.ownerUserId === clientUserId || provider.ownerUserId === actor.userId) {
      throw new BadRequestException('You cannot book your own listing');
    }

    return this.bookings.save(
      this.bookings.create({
        userId: clientUserId,
        bookedByUserId: actor.userId,
        providerType: dto.providerType,
        providerId: dto.providerId,
        amount: dto.amount.toFixed(2),
        currency: this.cfg.payments.currency,
        eventDate: dto.eventDate ?? null,
        notes: dto.notes,
        status: BookingStatus.REQUESTED,
      }),
    );
  }

  /**
   * Initiate payment: funds held in escrow, booking moves to PENDING.
   *
   * `idempotencyKey` makes a retried request (flaky network, double-tap) return
   * the original payment instead of creating a second escrow hold against the
   * same booking.
   */
  async pay(
    actor: AuthUser,
    bookingId: string,
    idempotencyKey?: string,
  ): Promise<{ booking: Booking; payment: Payment }> {
    if (idempotencyKey) {
      const prior = await this.payments.findOne({ where: { idempotencyKey } });
      if (prior) {
        const booking = await this.loadOrFail(prior.bookingId);
        await this.assertBuyerSide(actor, booking);
        return { booking, payment: prior };
      }
    }

    return this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const paymentRepo = manager.getRepository(Payment);

      // Lock the row so two concurrent pay calls cannot both create an escrow
      // hold against the same booking.
      const booking = await bookingRepo.findOne({
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Booking not found');
      await this.assertBuyerSide(actor, booking);
      this.assertTransition(booking.status, BookingStatus.PENDING);

      // Work out the split now and store it, so what the provider is owed is
      // fixed at the moment of payment and cannot drift if the rate changes.
      const { commission, payout } = this.splitAmount(booking.amount);

      const intent = await this.gateway.createEscrowHold(booking.amount, booking.currency);
      const payment = await paymentRepo.save(
        paymentRepo.create({
          bookingId: booking.id,
          userId: booking.userId,
          amount: booking.amount,
          commissionAmount: commission,
          payoutAmount: payout,
          currency: booking.currency,
          status: PaymentStatus.HELD_IN_ESCROW,
          provider: this.cfg.payments.provider,
          providerRef: intent.providerRef,
          idempotencyKey: idempotencyKey ?? null,
        }),
      );

      booking.status = BookingStatus.PENDING;
      await bookingRepo.save(booking);
      await this.outbox.record(
        {
          eventType: 'booking.payment_held',
          aggregateType: 'booking',
          payload: { bookingId: booking.id, userId: booking.userId, amount: booking.amount },
        },
        manager,
      );
      await this.audit.record(
        {
          action: AuditAction.BOOKING_ESCROW_HELD,
          actor,
          resourceType: 'booking',
          resourceId: booking.id,
          metadata: { amount: booking.amount, commission, payout },
        },
        manager,
      );
      return { booking, payment };
    });
  }

  /** Provider confirms the pending booking. Only the listing owner may do this. */
  async confirm(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertSellerSide(actor, booking);
    const saved = await this.transition(booking, BookingStatus.CONFIRMED);
    await this.outbox.record({
      eventType: 'booking.confirmed',
      aggregateType: 'booking',
      payload: { bookingId, providerId: booking.providerId },
    });
    return saved;
  }

  /** Provider marks the event delivered, which releases escrow to them. */
  async complete(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertSellerSide(actor, booking);
    const saved = await this.transition(booking, BookingStatus.COMPLETED);

    const payment = await this.payments.findOne({
      where: { bookingId, status: PaymentStatus.HELD_IN_ESCROW },
    });
    if (payment?.providerRef) {
      // Release only the seller share; the commission stays with the platform.
      // Recompute if the row predates the split columns.
      const stored = parseFloat(payment.payoutAmount) > 0;
      const split = stored
        ? { payout: payment.payoutAmount, commission: payment.commissionAmount }
        : this.splitAmount(payment.amount);

      await this.gateway.release(payment.providerRef, split.payout, payment.currency);
      await this.payments.update(payment.id, {
        status: PaymentStatus.RELEASED,
        payoutAmount: split.payout,
        commissionAmount: split.commission,
      });
      await this.audit.record({
        action: AuditAction.BOOKING_ESCROW_RELEASED,
        actor,
        resourceType: 'booking',
        resourceId: bookingId,
        metadata: { gross: payment.amount, payout: split.payout, commission: split.commission },
      });
    }
    await this.outbox.record({
      eventType: 'booking.completed',
      aggregateType: 'booking',
      payload: { bookingId },
    });
    return saved;
  }

  /** Either side may cancel; escrow is refunded to the buyer. */
  async cancel(actor: AuthUser, bookingId: string, reason?: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertParticipant(actor, booking);
    booking.cancellationReason = reason ?? null;
    const saved = await this.transition(booking, BookingStatus.CANCELLED);

    const payment = await this.payments.findOne({
      where: { bookingId, status: PaymentStatus.HELD_IN_ESCROW },
    });
    if (payment?.providerRef) {
      // Refunds return the FULL amount to the buyer: the platform earns no
      // commission on a booking that never happened.
      await this.gateway.refund(payment.providerRef, payment.amount);
      await this.payments.update(payment.id, {
        status: PaymentStatus.REFUNDED,
        commissionAmount: '0.00',
        payoutAmount: '0.00',
      });
      await this.audit.record({
        action: AuditAction.BOOKING_ESCROW_REFUNDED,
        actor,
        resourceType: 'booking',
        resourceId: bookingId,
        metadata: { amount: payment.amount, reason: reason ?? null },
      });
    }
    await this.outbox.record({
      eventType: 'booking.cancelled',
      aggregateType: 'booking',
      payload: { bookingId, cancelledBy: actor.userId },
    });
    return saved;
  }

  /** Buyer-side listing: own bookings, plus managed clients' for an agent. */
  async listForBuyer(actor: AuthUser, q: BookingSearchDto): Promise<PaginatedResult<Booking>> {
    const qb = this.bookings.createQueryBuilder('b');

    if (actor.role === UserRole.AGENT) {
      if (q.clientId) {
        await this.agents.assertManages(actor.userId, q.clientId);
        qb.where('b."userId" = :clientId', { clientId: q.clientId });
      } else {
        // Everything this agent placed, for whoever it was placed.
        qb.where('(b."bookedByUserId" = :me OR b."userId" = :me)', { me: actor.userId });
      }
    } else {
      qb.where('b."userId" = :me', { me: actor.userId });
    }

    if (q.status) qb.andWhere('b.status = :status', { status: q.status });
    qb.orderBy('b."createdAt"', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, q.page, q.limit);
  }

  /** Seller-side listing: bookings against the caller's own listings. */
  async listIncoming(actor: AuthUser, q: BookingSearchDto): Promise<PaginatedResult<Booking>> {
    const providerIds = await this.ownedProviderIds(actor);
    if (providerIds.length === 0) return paginate([], 0, q.page, q.limit);

    const qb = this.bookings
      .createQueryBuilder('b')
      .where('b."providerId" IN (:...ids)', { ids: providerIds });
    if (q.status) qb.andWhere('b.status = :status', { status: q.status });
    qb.orderBy('b."createdAt"', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, q.page, q.limit);
  }

  private async ownedProviderIds(actor: AuthUser): Promise<string[]> {
    if (actor.role === UserRole.VENDOR) {
      const rows = await this.vendors.find({ where: { ownerUserId: actor.userId } });
      return rows.map((r) => r.id);
    }
    if (actor.role === UserRole.PLANNER) {
      const rows = await this.planners.find({ where: { ownerUserId: actor.userId } });
      return rows.map((r) => r.id);
    }
    return [];
  }

  private async loadOrFail(bookingId: string): Promise<Booking> {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /** The buyer, or the agent who placed it, or an admin. */
  private async assertBuyerSide(actor: AuthUser, booking: Booking): Promise<void> {
    if (actor.role === UserRole.ADMIN) return;
    if (booking.userId === actor.userId) return;
    if (booking.bookedByUserId === actor.userId && actor.role === UserRole.AGENT) {
      await this.agents.assertManages(actor.userId, booking.userId);
      return;
    }
    throw new ForbiddenException('This booking does not belong to you');
  }

  /** The provider whose listing was booked, or an admin. */
  private async assertSellerSide(actor: AuthUser, booking: Booking): Promise<void> {
    if (actor.role === UserRole.ADMIN) return;
    const provider = await this.providerOwner(booking.providerType, booking.providerId);
    if (provider.ownerUserId !== actor.userId) {
      throw new ForbiddenException('This booking was not made against your listing');
    }
  }

  /** Either side of the booking. */
  private async assertParticipant(actor: AuthUser, booking: Booking): Promise<void> {
    if (actor.role === UserRole.ADMIN) return;
    try {
      await this.assertBuyerSide(actor, booking);
      return;
    } catch {
      // Not the buyer; fall through to the seller check, which throws if that
      // does not hold either.
    }
    await this.assertSellerSide(actor, booking);
  }

  /** True when this user completed a booking with the provider (review gate). */
  async hasCompletedBookingWith(
    userId: string,
    providerType: ProviderType,
    providerId: string,
  ): Promise<boolean> {
    const count = await this.bookings.count({
      where: { userId, providerType, providerId, status: BookingStatus.COMPLETED },
    });
    return count > 0;
  }

  private async transition(booking: Booking, to: BookingStatus): Promise<Booking> {
    this.assertTransition(booking.status, to);
    booking.status = to;
    return this.bookings.save(booking);
  }

  private assertTransition(from: BookingStatus, to: BookingStatus): void {
    if (!ALLOWED[from].includes(to)) {
      throw new BadRequestException(`Illegal booking transition ${from} to ${to}`);
    }
  }
}
