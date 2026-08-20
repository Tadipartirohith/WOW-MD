import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { Payment } from './entities/payment.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { BookingSearchDto, CreateBookingDto } from './dto/booking.dto';
import {
  BookingStatus,
  PaymentMilestone,
  PaymentStatus,
  ProviderType,
  UserRole,
  isConsumer,
  isIndividual,
} from '../../common/enums';
import { AppConfigService } from '../../config/app-config.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment.provider';
import { AgentsService } from '../agents/agents.service';
import { SupportCasesService } from '../verification/support-cases.service';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { AvailabilityService } from '../vendors/availability.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

/**
 * Booking lifecycle + escrow, as an explicit state machine.
 *
 * A quotation-driven job:
 *   REQUESTED -(vendor quotes)-> QUOTATION_SENT
 *             -(buyer accepts)-> QUOTATION_ACCEPTED -> PAYMENT_PENDING
 * A listed-price job skips the quote: REQUESTED -> PAYMENT_PENDING.
 *
 * Both then converge:
 *   PAYMENT_PENDING -(advance held)-> PENDING
 *                   -(provider confirms)-> CONFIRMED
 *                   -(work starts)-> IN_PROGRESS
 *                   -(delivered)-> COMPLETED[escrow released]
 *   raising a case -> DISPUTED[escrow frozen], settled by an officer
 *   most states -> CANCELLED[escrow refunded]
 */
const ALLOWED: Record<BookingStatus, BookingStatus[]> = {
  [BookingStatus.REQUESTED]: [
    BookingStatus.QUOTATION_SENT,
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.CANCELLED,
  ],
  // Re-quoting returns the booking to REQUESTED, so the buyer is never looking
  // at a stale price while the vendor prepares a new one.
  [BookingStatus.QUOTATION_SENT]: [
    BookingStatus.QUOTATION_ACCEPTED,
    BookingStatus.REQUESTED,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.QUOTATION_ACCEPTED]: [BookingStatus.PAYMENT_PENDING, BookingStatus.CANCELLED],
  [BookingStatus.PAYMENT_PENDING]: [BookingStatus.PENDING, BookingStatus.CANCELLED],
  [BookingStatus.PENDING]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
  [BookingStatus.CONFIRMED]: [
    BookingStatus.IN_PROGRESS,
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.IN_PROGRESS]: [
    BookingStatus.COMPLETED,
    BookingStatus.DISPUTED,
    BookingStatus.CANCELLED,
  ],
  // A dispute can surface after delivery — that is when most of them do.
  [BookingStatus.COMPLETED]: [BookingStatus.DISPUTED],
  [BookingStatus.DISPUTED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.CANCELLED]: [],
};

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly cfg: AppConfigService,
    private readonly outbox: OutboxService,
    private readonly dataSource: DataSource,
    private readonly agents: AgentsService,
    private readonly audit: AuditService,
    private readonly cases: SupportCasesService,
    private readonly matchmaking: MatchmakingService,
    // Bookings and the vendor calendar need each other; the cycle is broken
    // here rather than by duplicating the capacity rule in two places.
    @Inject(forwardRef(() => AvailabilityService))
    private readonly availability: AvailabilityService,
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

  /**
   * What a given milestone costs on this booking.
   *
   * The final instalment is the remainder rather than its own percentage, so
   * rounding can never leave a rupee uncollected or collect one too many:
   * advance + second + final always equals the booking total exactly.
   */
  milestoneAmount(total: string, milestone: PaymentMilestone): string {
    const gross = Math.round(parseFloat(total) * 100);
    const pct = this.cfg.payments.milestonePercents;
    const advance = Math.floor((gross * pct.advance) / 100);
    const second = Math.floor((gross * pct.second) / 100);

    const minor =
      milestone === PaymentMilestone.ADVANCE
        ? advance
        : milestone === PaymentMilestone.SECOND
          ? second
          : gross - advance - second;
    return (minor / 100).toFixed(2);
  }

  /** Every milestone on a booking, with what has been paid against each. */
  async milestones(actor: AuthUser, bookingId: string) {
    const booking = await this.loadOrFail(bookingId);
    await this.assertParticipant(actor, booking);

    const payments = await this.payments.find({ where: { bookingId } });
    const order = [PaymentMilestone.ADVANCE, PaymentMilestone.SECOND, PaymentMilestone.FINAL];
    return {
      bookingId,
      total: booking.amount,
      currency: booking.currency,
      milestones: order.map((milestone) => {
        const payment = payments.find((p) => p.milestone === milestone && !this.isDead(p.status));
        return {
          milestone,
          amount: this.milestoneAmount(booking.amount, milestone),
          status: payment?.status ?? null,
          paymentId: payment?.id ?? null,
        };
      }),
    };
  }

  /** A payment in one of these states does not occupy its milestone slot. */
  private isDead(status: PaymentStatus): boolean {
    return status === PaymentStatus.FAILED || status === PaymentStatus.REFUNDED;
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

    await this.assertServicesUnlocked(clientUserId);

    // A soft check, so the buyer is told now rather than after a quotation and
    // a deposit. The binding one runs under a lock at confirmation.
    if (dto.eventDate && dto.providerType === ProviderType.VENDOR) {
      if (!(await this.availability.isAvailable(dto.providerId, dto.eventDate))) {
        throw new BadRequestException('That vendor is not available on that date');
      }
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
   * The wedding marketplace opens once a match is fixed.
   *
   * The check runs against the *client* the booking is for, not the person
   * clicking, so an agent booking a venue for a client is held to the client's
   * status rather than their own. Accounts with no matchmaking profile at all —
   * an agency booking for its own office, say — are not part of this and pass
   * straight through.
   */
  private async assertServicesUnlocked(clientUserId: string): Promise<void> {
    if (!this.cfg.features.servicesRequireMatchFixed) return;

    const client = await this.users.findOne({
      where: { id: clientUserId },
      select: ['id', 'role'],
    });
    if (!client || !isIndividual(client.role)) return;

    const profile = await this.profiles.findOne({ where: { userId: clientUserId } });
    if (!profile) {
      throw new BadRequestException('Complete the profile before booking services');
    }
    if (!(await this.matchmaking.isMatchFixed(profile.id))) {
      throw new ForbiddenException(
        'Wedding services unlock once the match is fixed. Confirm the match first.',
      );
    }
  }

  /**
   * Pays one escrow milestone.
   *
   * The advance is what secures the booking, so it is the instalment that moves
   * the booking to PENDING; the second and final instalments are collected
   * against the same booking without changing its state. Milestones run in
   * order — collecting the balance before the deposit would defeat the point of
   * staging them.
   *
   * `idempotencyKey` makes a retried request (flaky network, double-tap) return
   * the original payment instead of creating a second escrow hold.
   */
  async pay(
    actor: AuthUser,
    bookingId: string,
    opts: { milestone?: PaymentMilestone; idempotencyKey?: string } = {},
  ): Promise<{ booking: Booking; payment: Payment }> {
    const milestone = opts.milestone ?? PaymentMilestone.ADVANCE;
    const idempotencyKey = opts.idempotencyKey;

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

      const existing = await paymentRepo.find({ where: { bookingId: booking.id } });
      const live = existing.filter((p) => !this.isDead(p.status));
      if (live.some((p) => p.milestone === milestone)) {
        throw new BadRequestException(`The ${milestone} instalment has already been paid`);
      }
      this.assertMilestoneOrder(
        milestone,
        live.map((p) => p.milestone),
      );

      const isAdvance = milestone === PaymentMilestone.ADVANCE;
      if (isAdvance) {
        // A quotation-driven booking is already at PAYMENT_PENDING when the
        // buyer accepted the quote; a listed-price one arrives straight from
        // REQUESTED. Both are legal, so the machine is asked rather than
        // second-guessed.
        if (booking.status !== BookingStatus.PAYMENT_PENDING) {
          this.assertTransition(booking.status, BookingStatus.PAYMENT_PENDING);
          booking.status = BookingStatus.PAYMENT_PENDING;
        }
        this.assertTransition(booking.status, BookingStatus.PENDING);
      } else if (
        booking.status === BookingStatus.CANCELLED ||
        booking.status === BookingStatus.COMPLETED
      ) {
        throw new BadRequestException('That booking is closed');
      }

      const amount = this.milestoneAmount(booking.amount, milestone);
      // The split is fixed at the moment of payment, so what the provider is
      // owed cannot drift if the commission rate changes later.
      const { commission, payout } = this.splitAmount(amount);

      const intent = await this.gateway.createEscrowHold(amount, booking.currency);
      const payment = await paymentRepo.save(
        paymentRepo.create({
          bookingId: booking.id,
          userId: booking.userId,
          amount,
          commissionAmount: commission,
          payoutAmount: payout,
          currency: booking.currency,
          status: PaymentStatus.HELD_IN_ESCROW,
          milestone,
          provider: this.cfg.payments.provider,
          providerRef: intent.providerRef,
          idempotencyKey: idempotencyKey ?? null,
        }),
      );

      if (isAdvance) booking.status = BookingStatus.PENDING;
      await bookingRepo.save(booking);

      await this.outbox.record(
        {
          eventType: 'booking.payment_held',
          aggregateType: 'booking',
          payload: { bookingId: booking.id, userId: booking.userId, amount, milestone },
        },
        manager,
      );
      await this.audit.record(
        {
          action: AuditAction.BOOKING_ESCROW_HELD,
          actor,
          resourceType: 'booking',
          resourceId: booking.id,
          metadata: { amount, milestone, commission, payout },
        },
        manager,
      );
      return { booking, payment };
    });
  }

  /** Instalments run advance, second, final. Skipping ahead is refused. */
  private assertMilestoneOrder(next: PaymentMilestone, paid: PaymentMilestone[]): void {
    const required: Record<PaymentMilestone, PaymentMilestone[]> = {
      [PaymentMilestone.ADVANCE]: [],
      [PaymentMilestone.SECOND]: [PaymentMilestone.ADVANCE],
      [PaymentMilestone.FINAL]: [PaymentMilestone.ADVANCE, PaymentMilestone.SECOND],
    };
    const missing = required[next].filter((m) => !paid.includes(m));
    if (missing.length > 0) {
      throw new BadRequestException(`Pay the ${missing.join(' and ')} instalment first`);
    }
  }

  /** Provider confirms the pending booking. Only the listing owner may do this. */
  /**
   * Provider confirms the pending booking. Only the listing owner may do this.
   *
   * Confirmation is where the date is actually taken. Both writes happen in one
   * transaction with the calendar row locked, so two bookings racing for the
   * last slot on a date cannot both succeed — for a wedding vendor that clash
   * has no recovery.
   */
  async confirm(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertSellerSide(actor, booking);

    const saved = await this.dataSource.transaction(async (manager) => {
      if (booking.eventDate && booking.providerType === ProviderType.VENDOR) {
        await this.availability.reserve(manager, booking.providerId, booking.eventDate);
      }
      this.assertTransition(booking.status, BookingStatus.CONFIRMED);
      booking.status = BookingStatus.CONFIRMED;
      return manager.getRepository(Booking).save(booking);
    });

    await this.outbox.record({
      eventType: 'booking.confirmed',
      aggregateType: 'booking',
      payload: { bookingId, providerId: booking.providerId, eventDate: booking.eventDate },
    });
    return saved;
  }

  /** Provider marks work as started. Purely a signal to the buyer. */
  async startWork(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertSellerSide(actor, booking);
    return this.transition(booking, BookingStatus.IN_PROGRESS);
  }

  /**
   * Provider marks the event delivered, which releases every held instalment.
   *
   * An open case blocks this outright. Escrow that a provider can release while
   * the buyer is disputing it is not escrow, so the check comes before the
   * transition rather than after.
   */
  async complete(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertSellerSide(actor, booking);
    if (await this.cases.hasOpenCaseFor(bookingId)) {
      throw new BadRequestException(
        'An open case is holding the money on this booking. It is released by a settlement decision.',
      );
    }
    const saved = await this.transition(booking, BookingStatus.COMPLETED);

    const held = await this.payments.find({
      where: { bookingId, status: PaymentStatus.HELD_IN_ESCROW },
    });
    for (const payment of held) {
      if (!payment.providerRef) continue;
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
        metadata: {
          gross: payment.amount,
          milestone: payment.milestone,
          payout: split.payout,
          commission: split.commission,
        },
      });
    }

    await this.outbox.record({
      eventType: 'booking.completed',
      aggregateType: 'booking',
      payload: { bookingId, released: held.length },
    });
    return saved;
  }

  /** Either side may cancel; every held instalment is refunded to the buyer. */
  async cancel(actor: AuthUser, bookingId: string, reason?: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertParticipant(actor, booking);
    if (await this.cases.hasOpenCaseFor(bookingId)) {
      throw new BadRequestException(
        'An open case is holding the money on this booking. It is refunded by a settlement decision.',
      );
    }
    const heldTheDate =
      booking.status === BookingStatus.CONFIRMED || booking.status === BookingStatus.IN_PROGRESS;
    booking.cancellationReason = reason ?? null;
    const saved = await this.transition(booking, BookingStatus.CANCELLED);

    // Give the date back to the vendor's calendar — only if this booking was
    // actually holding it, or a cancellation before confirmation would free a
    // slot it never took.
    if (heldTheDate && booking.eventDate && booking.providerType === ProviderType.VENDOR) {
      await this.availability.release(booking.providerId, booking.eventDate);
    }

    const held = await this.payments.find({
      where: { bookingId, status: PaymentStatus.HELD_IN_ESCROW },
    });
    for (const payment of held) {
      if (!payment.providerRef) continue;
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
        metadata: { amount: payment.amount, milestone: payment.milestone, reason: reason ?? null },
      });
    }

    await this.outbox.record({
      eventType: 'booking.cancelled',
      aggregateType: 'booking',
      payload: { bookingId, cancelledBy: actor.userId, refunded: held.length },
    });
    return saved;
  }

  /**
   * Moves a booking into DISPUTED. Called by the support-case flow rather than
   * by a controller, so the booking state and the frozen money always change
   * together.
   */
  async markDisputed(bookingId: string): Promise<void> {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) return;
    if (!ALLOWED[booking.status].includes(BookingStatus.DISPUTED)) return;
    booking.status = BookingStatus.DISPUTED;
    await this.bookings.save(booking);
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

  // The quotation flow lives in its own service but answers to the same
  // ownership rules, so the three checks are exposed rather than reimplemented.

  /** Throws unless the caller is the buyer, or the agent who booked for them. */
  assertBuyer(actor: AuthUser, booking: Booking): Promise<void> {
    return this.assertBuyerSide(actor, booking);
  }

  /** Throws unless the caller owns the listing that was booked. */
  assertSeller(actor: AuthUser, booking: Booking): Promise<void> {
    return this.assertSellerSide(actor, booking);
  }

  /** Throws unless the caller is on one side of the booking or the other. */
  assertEitherSide(actor: AuthUser, booking: Booking): Promise<void> {
    return this.assertParticipant(actor, booking);
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
