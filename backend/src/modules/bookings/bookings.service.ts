import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { Payment } from './entities/payment.entity';
import { WeddingEvent } from '../events/entities/event.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
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
  isIndividual,
} from '../../common/enums';
import { AppConfigService } from '../../config/app-config.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { PAYMENT_PROVIDER, PaymentProvider, PayoutDestination } from './payment.provider';
import { AgentsService } from '../agents/agents.service';
import { SupportCasesService } from '../verification/support-cases.service';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { AvailabilityService } from '../vendors/availability.service';
import { VendorServicesService } from '../catalog/vendor-services.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

/**
 * The client branches on this to open the request the buyer already has rather
 * than showing them a bare error.
 */
export const DUPLICATE_BOOKING_REQUEST = 'DUPLICATE_BOOKING_REQUEST';

/** Money is added in minor units; summing decimal strings drifts a paisa at a time. */
const toMinor = (amount: string): number => Math.round(parseFloat(amount || '0') * 100);
const toMajor = (minor: number): string => (minor / 100).toFixed(2);

/**
 * Booking lifecycle + escrow, as an explicit state machine.
 *
 * The spine of it is that **money and work alternate**, and neither side can
 * get ahead of the other:
 *
 *   REQUESTED ─quote→ QUOTATION_SENT ─buyer accepts→ QUOTATION_ACCEPTED
 *     └─ provider agrees → PAYMENT_PENDING
 *          └─ advance held → CONFIRMED
 *               └─ provider starts → IN_PROGRESS
 *                    └─ second instalment → provider may finish
 *                         └─ provider confirms → COMPLETED_PENDING_FINAL_PAYMENT
 *                              └─ balance paid → COMPLETED [escrow released]
 *
 * A provider cannot start before being paid something, and a buyer cannot be
 * asked for the balance before the work is done. Every one of those gates is
 * enforced here rather than by hiding a button, because the button is not what
 * an attacker uses.
 *
 * Raising a case moves the booking to DISPUTED and freezes the money until an
 * officer settles it; most states can still be cancelled, which refunds.
 */
const ALLOWED: Record<BookingStatus, BookingStatus[]> = {
  [BookingStatus.REQUESTED]: [
    BookingStatus.QUOTATION_SENT,
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.CANCELLED,
  ],
  // Re-quoting returns the booking to REQUESTED, so the buyer is never looking
  // at a stale price while the provider prepares a new one.
  [BookingStatus.QUOTATION_SENT]: [
    BookingStatus.QUOTATION_ACCEPTED,
    BookingStatus.REQUESTED,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.QUOTATION_ACCEPTED]: [BookingStatus.PAYMENT_PENDING, BookingStatus.CANCELLED],
  [BookingStatus.PAYMENT_PENDING]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
  // Historic state; nothing enters it any more.
  [BookingStatus.PENDING]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
  [BookingStatus.CONFIRMED]: [BookingStatus.IN_PROGRESS, BookingStatus.CANCELLED],
  [BookingStatus.IN_PROGRESS]: [
    BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
    BookingStatus.DISPUTED,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT]: [
    BookingStatus.COMPLETED,
    BookingStatus.DISPUTED,
    BookingStatus.CANCELLED,
  ],
  // A dispute can surface after delivery — that is when most of them do.
  [BookingStatus.COMPLETED]: [BookingStatus.DISPUTED],
  [BookingStatus.DISPUTED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.CANCELLED]: [],
};

/** States in which a slot is still being held for this booking. */
const HOLDS_SLOT: BookingStatus[] = [
  BookingStatus.REQUESTED,
  BookingStatus.QUOTATION_SENT,
  BookingStatus.QUOTATION_ACCEPTED,
  BookingStatus.PAYMENT_PENDING,
  BookingStatus.PENDING,
  BookingStatus.CONFIRMED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
];

/**
 * A request that is still live, for the "one at a time" rule. A rejected
 * quotation does **not** end a request — the provider can re-quote inside it —
 * so only cancellation and completion free the buyer to ask again.
 */
const ACTIVE_REQUEST: BookingStatus[] = HOLDS_SLOT;

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    // Read-only, so a provider's booking row can say who and where it is for.
    @InjectRepository(WeddingEvent) private readonly events: Repository<WeddingEvent>,
    @InjectRepository(VendorService) private readonly serviceRows: Repository<VendorService>,
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
    // The catalog validates a buyer's answers against the same rows the form
    // they filled in was generated from. Keeping that in one place is what
    // stops the form and its submission drifting apart.
    @Inject(forwardRef(() => VendorServicesService))
    private readonly vendorServices: VendorServicesService,
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
   * Places a booking request.
   *
   * For a vendor this means holding one of their published windows: the slot is
   * reserved inside the same transaction that writes the booking, so two buyers
   * racing for the last Saturday afternoon cannot both succeed.
   */
  async create(actor: AuthUser, dto: CreateBookingDto): Promise<Booking> {
    // The wedding marketplace belongs to the couple. An agency introduces two
    // families and is paid for that; it does not hire their photographer, and
    // it certainly does not hold their escrow. Booking on somebody else's
    // behalf was removed with that scope, not merely hidden.
    if (!isIndividual(actor.role)) {
      throw new ForbiddenException('Only the couple and their family can place bookings');
    }

    const clientUserId = actor.userId;
    await this.assertServicesUnlocked(clientUserId);

    const provider = await this.providerOwner(dto.providerType, dto.providerId);
    if (!provider.isApproved) {
      throw new BadRequestException('That provider is not yet approved for bookings');
    }
    if (provider.ownerUserId === clientUserId || provider.ownerUserId === actor.userId) {
      throw new BadRequestException('You cannot book your own listing');
    }

    // One live request per buyer, provider, event and slot. Sending the same
    // request twice is almost always a double-click or an impatient refresh,
    // and answering it with a second request would have the provider quoting
    // the same job twice.
    const existing = await this.findActiveRequest(clientUserId, dto);
    if (existing) {
      throw new ConflictException({
        message:
          'You already have an active booking request with this provider for that event and slot.',
        code: DUPLICATE_BOOKING_REQUEST,
        bookingId: existing.id,
      });
    }

    if (dto.slotId) {
      const slot = await this.availability.findSlot(dto.slotId);
      // Both halves. A slot is identified by the provider it belongs to and
      // the kind of provider that is, so a planner's slot id can never be
      // presented against a vendor booking.
      if (!slot || slot.providerId !== dto.providerId || slot.providerType !== dto.providerType) {
        throw new BadRequestException('That time slot does not belong to this provider');
      }
      if (dto.eventDate && dto.eventDate !== slot.date) {
        throw new BadRequestException('The event date does not match the slot you chose');
      }
      // The window is re-checked here as well as under the lock below, so a
      // buyer working from a page that went stale while they filled the form
      // in is told now rather than after their answers are thrown away.
      if (!(await this.availability.isBookable(dto.providerId, dto.slotId))) {
        throw new BadRequestException('That time slot is no longer open. Pick another.');
      }
    }

    // What the catalog contributes: the buyer's answers are validated against
    // the same rows the form they filled in was generated from, and the chosen
    // price is proved to belong to the service they chose.
    let serviceAnswers: Record<string, unknown> = {};
    if (dto.vendorServiceId) {
      const { service, answers } = await this.vendorServices.validateBookingAnswers(
        dto.vendorServiceId,
        dto.serviceAnswers,
      );
      if (service.vendorId !== dto.providerId) {
        throw new BadRequestException('That service does not belong to this provider');
      }
      serviceAnswers = answers;

      if (dto.offeringId) {
        const offering = await this.vendorServices.findOffering(dto.offeringId);
        if (!offering || offering.vendorServiceId !== service.id) {
          throw new BadRequestException('That price is not on the service you chose');
        }
        if (!offering.active) {
          throw new BadRequestException('That price is no longer offered');
        }
        if (offering.minQuantity && (dto.quantity ?? 0) < offering.minQuantity) {
          throw new BadRequestException(
            `${offering.name} starts at ${offering.minQuantity}${offering.unitLabel ? ' ' + offering.unitLabel : ''}`,
          );
        }
        if (offering.maxQuantity && (dto.quantity ?? 0) > offering.maxQuantity) {
          throw new BadRequestException(
            `${offering.name} tops out at ${offering.maxQuantity}${offering.unitLabel ? ' ' + offering.unitLabel : ''}`,
          );
        }
      }
    } else if (dto.serviceAnswers && Object.keys(dto.serviceAnswers).length > 0) {
      // Answers with nothing to validate them against would be stored
      // unchecked, which is the one thing the catalog exists to prevent.
      throw new BadRequestException('Choose a service before answering its questions');
    }

    return this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const booking = await bookingRepo.save(
        bookingRepo.create({
          userId: clientUserId,
          bookedByUserId: actor.userId,
          providerType: dto.providerType,
          providerId: dto.providerId,
          slotId: dto.slotId ?? null,
          eventId: dto.eventId ?? null,
          // A request carries no committed price: the provider quotes against
          // the requirements. `amount` stays zero until a quotation is accepted.
          amount: (dto.amount ?? 0).toFixed(2),
          currency: this.cfg.payments.currency,
          eventDate: dto.eventDate ?? null,
          requirements: dto.requirements ?? null,
          vendorServiceId: dto.vendorServiceId ?? null,
          offeringId: dto.offeringId ?? null,
          serviceAnswers,
          quantity: dto.quantity ?? null,
          expectedBudget: dto.expectedBudget !== undefined ? dto.expectedBudget.toFixed(2) : null,
          notes: dto.notes,
          status: BookingStatus.REQUESTED,
        }),
      );

      if (dto.slotId) await this.availability.reserve(manager, dto.slotId);

      await this.outbox.record(
        {
          eventType: 'booking.requested',
          aggregateType: 'booking',
          payload: {
            bookingId: booking.id,
            userId: clientUserId,
            providerId: dto.providerId,
            slotId: dto.slotId ?? null,
          },
        },
        manager,
      );
      return booking;
    });
  }

  /** The live request for this buyer/provider/event/slot, if there is one. */
  private async findActiveRequest(
    clientUserId: string,
    dto: CreateBookingDto,
  ): Promise<Booking | null> {
    const candidates = await this.bookings.find({
      where: {
        userId: clientUserId,
        providerType: dto.providerType,
        providerId: dto.providerId,
        status: In(ACTIVE_REQUEST),
      },
    });

    return (
      candidates.find(
        (b) =>
          (dto.slotId ? b.slotId === dto.slotId : true) &&
          (dto.eventId ? b.eventId === dto.eventId : true) &&
          (!dto.slotId && !dto.eventId ? b.eventDate === (dto.eventDate ?? null) : true),
      ) ?? null
    );
  }

  /**
   * The wedding marketplace, and who may buy from it.
   *
   * Open to everybody by default. The platform earns on vendor bookings, and a
   * match fixed at home — which is how most of them are fixed — is still a
   * wedding that needs a caterer. Making matchmaking a toll gate in front of
   * the shop turns paying customers away at the door to protect a funnel they
   * were never in.
   *
   * The gate survives behind `SERVICES_REQUIRE_MATCH_FIXED` for an operator
   * running matchmaking as the front door, and when it is on the check runs
   * against the *client* the booking is for, not the person clicking, so an
   * agent booking a venue for a client is held to the client's status rather
   * than their own. Accounts with no matchmaking profile at all — an agency
   * booking for its own office, say — are never part of it either way.
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
   * Each instalment is tied to a point in the work, not just to the one before
   * it: the advance secures the job, the second falls due once the provider has
   * actually started, and the balance only once they say it is finished. The
   * gate is here rather than in the UI, because a disabled button stops nobody
   * who is willing to call the API directly.
   *
   * `idempotencyKey` makes a retried request (flaky network, double-tap) return
   * the original payment instead of holding a second time.
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

      // Lock the row so two concurrent pay calls cannot both create a hold.
      const booking = await bookingRepo.findOne({
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Booking not found');
      await this.assertBuyerSide(actor, booking);

      if (parseFloat(booking.amount) <= 0) {
        throw new BadRequestException(
          'This booking has no agreed price yet — accept a quotation first',
        );
      }

      const existing = await paymentRepo.find({ where: { bookingId: booking.id } });
      const live = existing.filter((p) => !this.isDead(p.status));
      if (live.some((p) => p.milestone === milestone)) {
        throw new BadRequestException(`The ${milestone} instalment has already been paid`);
      }
      this.assertMilestoneAllowed(booking, milestone, live);

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

      // The advance is what turns an agreement into a booking; the balance is
      // what closes it. The middle instalment changes no state of its own.
      if (milestone === PaymentMilestone.ADVANCE) {
        this.assertTransition(booking.status, BookingStatus.CONFIRMED);
        booking.status = BookingStatus.CONFIRMED;
        // Capacity was consumed when the provider accepted the job, not here.
        // The window has been theirs since then; the advance only releases
        // them to start work.
      } else if (milestone === PaymentMilestone.FINAL) {
        this.assertTransition(booking.status, BookingStatus.COMPLETED);
        booking.status = BookingStatus.COMPLETED;
      }
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

  /**
   * Whether this instalment is due yet.
   *
   * Two conditions, both necessary: the instalments run in order, and each one
   * is unlocked by something the provider has done.
   */
  private assertMilestoneAllowed(
    booking: Booking,
    next: PaymentMilestone,
    paid: Payment[],
  ): void {
    const done = paid.map((p) => p.milestone);
    const required: Record<PaymentMilestone, PaymentMilestone[]> = {
      [PaymentMilestone.ADVANCE]: [],
      [PaymentMilestone.SECOND]: [PaymentMilestone.ADVANCE],
      [PaymentMilestone.FINAL]: [PaymentMilestone.ADVANCE, PaymentMilestone.SECOND],
    };
    const missing = required[next].filter((m) => !done.includes(m));
    if (missing.length > 0) {
      throw new BadRequestException(`Pay the ${missing.join(' and ')} instalment first`);
    }

    const gate: Record<PaymentMilestone, { states: BookingStatus[]; because: string }> = {
      [PaymentMilestone.ADVANCE]: {
        states: [BookingStatus.PAYMENT_PENDING, BookingStatus.PENDING],
        because: 'The provider has to accept the job before the advance is payable',
      },
      [PaymentMilestone.SECOND]: {
        states: [BookingStatus.IN_PROGRESS],
        because: 'The second instalment falls due once the provider has started work',
      },
      [PaymentMilestone.FINAL]: {
        states: [BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT],
        because: 'The balance falls due once the provider has confirmed the work is finished',
      },
    };
    if (!gate[next].states.includes(booking.status)) {
      throw new BadRequestException(gate[next].because);
    }
  }

  /**
   * The provider accepts the job. From here the buyer can pay the advance.
   *
   * On a quotation-driven booking the price is already agreed; on a
   * listed-price one this is where the provider signs up to it.
   */
  async confirm(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertSellerSide(actor, booking);

    if (parseFloat(booking.amount) <= 0) {
      throw new BadRequestException('Send a quotation before accepting this job');
    }

    // This is the moment the window is actually spent.
    //
    // Not when the buyer asked, not when the quotation went out, not when the
    // buyer accepted it — a request is a question and this is the answer. And
    // not at the advance either: by then the provider has already promised the
    // day, and discovering a clash at payment time is discovering it too late.
    //
    // The capacity re-check lives under a row lock inside `availability.confirm`,
    // because between the family asking and the provider answering, other
    // people may have been confirmed into the same window.
    return this.dataSource.transaction(async (manager) => {
      if (booking.slotId) await this.availability.confirm(manager, booking.slotId);

      this.assertTransition(booking.status, BookingStatus.PAYMENT_PENDING);
      booking.status = BookingStatus.PAYMENT_PENDING;
      const saved = await manager.getRepository(Booking).save(booking);

      await this.outbox.record(
        {
          eventType: 'booking.confirmed',
          aggregateType: 'booking',
          payload: { bookingId, providerId: booking.providerId, amount: booking.amount },
        },
        manager,
      );
      return saved;
    });
  }

  /**
   * The provider says they have started. Refused until the advance is actually
   * held — that is the entire purpose of taking one.
   */
  async startWork(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertSellerSide(actor, booking);

    if (!(await this.hasHeld(bookingId, PaymentMilestone.ADVANCE))) {
      throw new BadRequestException('The advance payment has not been completed yet');
    }
    booking.startedAt = new Date();
    const saved = await this.transition(booking, BookingStatus.IN_PROGRESS);

    await this.outbox.record({
      eventType: 'booking.started',
      aggregateType: 'booking',
      payload: { bookingId, userId: booking.userId },
    });
    return saved;
  }

  /**
   * The provider says the work is delivered. This does not complete the
   * booking — it makes the balance payable, and paying it is what completes it.
   */
  async completeWork(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertSellerSide(actor, booking);

    if (await this.cases.hasOpenCaseFor(bookingId)) {
      throw new BadRequestException(
        'An open case is holding this booking. It moves on when a settlement is recorded.',
      );
    }
    if (!(await this.hasHeld(bookingId, PaymentMilestone.SECOND))) {
      throw new BadRequestException('The second instalment has not been completed yet');
    }

    booking.completedAt = new Date();
    const saved = await this.transition(booking, BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT);

    await this.outbox.record({
      eventType: 'booking.work_completed',
      aggregateType: 'booking',
      payload: { bookingId, userId: booking.userId },
    });
    return saved;
  }

  /**
   * Releases every held instalment to the provider.
   *
   * Called once the balance is in and the booking is complete. An open case
   * blocks it outright: escrow a provider can release while the buyer disputes
   * it is not escrow.
   */
  async settle(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertParticipant(actor, booking);

    if (booking.status !== BookingStatus.COMPLETED) {
      throw new BadRequestException('The booking is not complete yet');
    }
    if (await this.cases.hasOpenCaseFor(bookingId)) {
      throw new BadRequestException(
        'An open case is holding the money on this booking. It is released by a settlement decision.',
      );
    }

    await this.releaseHeld(actor, bookingId);
    return booking;
  }

  /**
   * Moves every held payment on a booking to the provider.
   *
   * A provider whose payout onboarding is not finished has no account to
   * transfer to. That is a normal state — they can take bookings and complete
   * work while their KYC clears — so the money stays in escrow with the reason
   * recorded, rather than being marked released against a transfer that never
   * happened. `PENDING_PAYOUT` is the difference between "we paid them" and "we
   * owe them", and collapsing those two was the thing worth avoiding.
   */
  private async releaseHeld(actor: AuthUser | undefined, bookingId: string): Promise<number> {
    const held = await this.payments.find({
      where: { bookingId, status: PaymentStatus.HELD_IN_ESCROW },
    });
    if (held.length === 0) return 0;

    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    const destination = booking
      ? await this.payoutDestination(booking)
      : { accountId: null, label: 'unknown provider' };

    let moved = 0;
    for (const payment of held) {
      if (!payment.providerRef) continue;
      // Release only the seller share; the commission stays with the platform.
      // Recompute if the row predates the split columns.
      const stored = parseFloat(payment.payoutAmount) > 0;
      const split = stored
        ? { payout: payment.payoutAmount, commission: payment.commissionAmount }
        : this.splitAmount(payment.amount);

      const result = await this.gateway.release(
        payment.providerRef,
        split.payout,
        payment.currency,
        destination,
      );

      await this.payments.update(payment.id, {
        status: result.transferred ? PaymentStatus.RELEASED : PaymentStatus.PENDING_PAYOUT,
        payoutAmount: split.payout,
        commissionAmount: split.commission,
        payoutRef: result.transferRef,
        payoutNote: result.reason,
      });
      if (result.transferred) moved += 1;

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
          transferred: result.transferred,
          reason: result.reason,
        },
      });
    }
    return moved;
  }

  /** The seller's linked account on the gateway, and who they are. */
  private async payoutDestination(booking: Booking): Promise<PayoutDestination> {
    if (booking.providerType === ProviderType.VENDOR) {
      const vendor = await this.vendors.findOne({ where: { id: booking.providerId } });
      return { accountId: vendor?.payoutAccountId ?? null, label: vendor?.name ?? 'vendor' };
    }
    const planner = await this.planners.findOne({ where: { id: booking.providerId } });
    return { accountId: planner?.payoutAccountId ?? null, label: planner?.agencyName ?? 'planner' };
  }

  /**
   * Retries a payout that could not be made when the work was completed.
   *
   * Run on a schedule rather than left for somebody to notice: the usual reason
   * is a provider finishing their onboarding a week after finishing the job,
   * and there is no event to hang that on.
   */
  async retryPendingPayouts(): Promise<{ attempted: number; released: number }> {
    const pending = await this.payments.find({
      where: { status: PaymentStatus.PENDING_PAYOUT },
    });

    let released = 0;
    for (const payment of pending) {
      if (!payment.providerRef) continue;
      const booking = await this.bookings.findOne({ where: { id: payment.bookingId } });
      if (!booking) continue;

      const destination = await this.payoutDestination(booking);
      if (!destination.accountId) continue;

      const result = await this.gateway.release(
        payment.providerRef,
        payment.payoutAmount,
        payment.currency,
        destination,
      );
      if (!result.transferred) continue;

      await this.payments.update(payment.id, {
        status: PaymentStatus.RELEASED,
        payoutRef: result.transferRef,
        payoutNote: null,
      });
      released += 1;
    }
    return { attempted: pending.length, released };
  }

  /** Is this instalment held (or already released) on this booking? */
  private async hasHeld(bookingId: string, milestone: PaymentMilestone): Promise<boolean> {
    const count = await this.payments.count({
      where: [
        { bookingId, milestone, status: PaymentStatus.HELD_IN_ESCROW },
        { bookingId, milestone, status: PaymentStatus.RELEASED },
        { bookingId, milestone, status: PaymentStatus.DISPUTED },
      ],
    });
    return count > 0;
  }

  /**
   * Either side may cancel; every held instalment is refunded and the slot goes
   * back on sale.
   */
  async cancel(actor: AuthUser, bookingId: string, reason?: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertParticipant(actor, booking);
    if (await this.cases.hasOpenCaseFor(bookingId)) {
      throw new BadRequestException(
        'An open case is holding the money on this booking. It is refunded by a settlement decision.',
      );
    }

    // "Confirmed" here means the provider had accepted the job and the window
    // was spent — which now happens at PAYMENT_PENDING, not at the advance.
    // Cancelling from earlier than that gives back a pending request instead.
    const wasConfirmed = [
      BookingStatus.PAYMENT_PENDING,
      BookingStatus.CONFIRMED,
      BookingStatus.IN_PROGRESS,
      BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
    ].includes(booking.status);
    const heldSlot = HOLDS_SLOT.includes(booking.status);

    booking.cancellationReason = reason ?? null;
    const saved = await this.transition(booking, BookingStatus.CANCELLED);

    // Give the window back. `wasConfirmed` decides whether a confirmed booking
    // is being un-counted or a mere request is being let go.
    if (heldSlot && booking.slotId) {
      await this.availability.release(booking.slotId, wasConfirmed);
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
    const named = await this.withProviderNames(data);
    return paginate(await this.withClientContext(named), total, q.page, q.limit);
  }

  /**
   * How many of each status are waiting, for the tabs above the list.
   *
   * Counted rather than derived from the current page: a tab reading
   * "Requests" with no number beside it tells a provider nothing, and one
   * counting only what happens to be on screen is worse than none.
   */
  async incomingCounts(actor: AuthUser): Promise<Record<string, number>> {
    const providerIds = await this.ownedProviderIds(actor);
    if (providerIds.length === 0) return {};

    const rows = await this.bookings
      .createQueryBuilder('b')
      .select('b.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('b."providerId" IN (:...ids)', { ids: providerIds })
      .groupBy('b.status')
      .getRawMany<{ status: string; count: string }>();

    const counts: Record<string, number> = { all: 0 };
    for (const row of rows) {
      counts[row.status] = Number(row.count);
      counts.all += Number(row.count);
    }
    return counts;
  }

  /**
   * Who the job is for, what it is, and whether money has moved.
   *
   * All of it existed and none of it was on the row. A provider deciding
   * whether to take a Saturday needs the couple, the date, the venue, the head
   * count and the service in front of them — and the payment state, because
   * "confirmed" and "confirmed and paid for" are different amounts of
   * commitment.
   */
  private async withClientContext(rows: Booking[]): Promise<Booking[]> {
    if (rows.length === 0) return rows;

    const userIds = [...new Set(rows.map((b) => b.userId))];
    const eventIds = [...new Set(rows.map((b) => b.eventId).filter(Boolean))] as string[];
    const serviceIds = [...new Set(rows.map((b) => b.vendorServiceId).filter(Boolean))] as string[];

    const [users, profiles, events, payments, services] = await Promise.all([
      this.users.find({ where: { id: In(userIds) }, select: ['id', 'email', 'phone'] }),
      this.profiles.find({ where: { userId: In(userIds) } }),
      eventIds.length ? this.events.find({ where: { id: In(eventIds) } }) : Promise.resolve([]),
      this.payments.find({ where: { bookingId: In(rows.map((b) => b.id)) } }),
      serviceIds.length
        ? this.serviceRows.find({ where: { id: In(serviceIds) } })
        : Promise.resolve([]),
    ]);

    const byUser = new Map(users.map((u) => [u.id, u]));
    const nameByUser = new Map(profiles.map((p) => [p.userId as string, p.displayName]));
    const byEvent = new Map(events.map((e) => [e.id, e]));
    const byService = new Map(services.map((v) => [v.id, v]));

    // The furthest a booking's money has got. Several payments can exist for
    // one booking — an advance and a balance — and what a provider wants is
    // the state of the job, not a list of transactions.
    const RANK: Record<string, number> = {
      initiated: 1,
      held_in_escrow: 2,
      disputed: 3,
      pending_payout: 4,
      released: 5,
      refunded: 6,
    };
    const paymentByBooking = new Map<string, string>();
    for (const payment of payments) {
      const seen = paymentByBooking.get(payment.bookingId);
      if (!seen || (RANK[payment.status] ?? 0) > (RANK[seen] ?? 0)) {
        paymentByBooking.set(payment.bookingId, payment.status);
      }
    }

    for (const booking of rows) {
      const user = byUser.get(booking.userId);
      const event = booking.eventId ? byEvent.get(booking.eventId) : undefined;
      booking.clientName = nameByUser.get(booking.userId) ?? null;
      booking.clientEmail = user?.email ?? null;
      booking.clientPhone = user?.phone ?? null;
      booking.eventName = event?.name ?? null;
      booking.eventVenue = event?.venue ?? null;
      booking.eventCity = event?.city ?? null;
      booking.expectedGuests = event?.expectedGuests ?? null;
      booking.serviceName = booking.vendorServiceId
        ? (byService.get(booking.vendorServiceId)?.displayName ?? null)
        : null;
      booking.paymentStatus = paymentByBooking.get(booking.id) ?? null;
    }
    return rows;
  }

  /**
   * Attaches the provider's trading name to each row.
   *
   * Without it the client holds a uuid and nothing else, and every booking list
   * reads as a wall of hex. Resolved in one query per provider type rather than
   * one per row.
   */
  private async withProviderNames<T extends Booking>(rows: T[]): Promise<T[]> {
    if (rows.length === 0) return rows;

    const vendorIds = rows
      .filter((r) => r.providerType === ProviderType.VENDOR)
      .map((r) => r.providerId);
    const plannerIds = rows
      .filter((r) => r.providerType === ProviderType.PLANNER)
      .map((r) => r.providerId);

    const [vendors, planners] = await Promise.all([
      vendorIds.length ? this.vendors.find({ where: { id: In(vendorIds) } }) : Promise.resolve([]),
      plannerIds.length ? this.planners.find({ where: { id: In(plannerIds) } }) : Promise.resolve([]),
    ]);

    const names = new Map<string, string>();
    for (const v of vendors) names.set(v.id, v.name);
    for (const p of planners) names.set(p.id, p.agencyName);

    return rows.map((row) =>
      Object.assign(row, { providerName: names.get(row.providerId) ?? 'Provider' }),
    );
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
    return paginate(await this.withProviderNames(data), total, q.page, q.limit);
  }

  /**
   * The provider's account: what has been earned, what is still in escrow, and
   * the line-by-line ledger behind both.
   *
   * Held and released are reported separately because they mean very different
   * things to somebody deciding whether they can pay their own suppliers this
   * week. Everything is net of commission — the payout figure is the money that
   * actually reaches them, so it is the one shown as earnings.
   */
  async earnings(actor: AuthUser): Promise<{
    heldInEscrow: string;
    /** Earned and owed, but not yet transferred. Usually payout onboarding. */
    pendingPayout: string;
    released: string;
    refunded: string;
    commission: string;
    gross: string;
    currency: string;
    ledger: {
      paymentId: string;
      bookingId: string;
      milestone: PaymentMilestone;
      status: PaymentStatus;
      amount: string;
      commissionAmount: string;
      payoutAmount: string;
      /** The gateway's reference for the transfer, once one is made. */
      payoutRef: string | null;
      /** Why a payout has not happened, when it has not. */
      payoutNote: string | null;
      confirmedAt: Date | null;
      createdAt: Date;
    }[];
  }> {
    const providerIds = await this.ownedProviderIds(actor);
    const empty = {
      heldInEscrow: '0.00',
      pendingPayout: '0.00',
      released: '0.00',
      refunded: '0.00',
      commission: '0.00',
      gross: '0.00',
      currency: 'INR',
      ledger: [],
    };
    if (providerIds.length === 0) return empty;

    const bookings = await this.bookings.find({
      where: { providerId: In(providerIds) },
      select: ['id', 'currency'],
    });
    if (bookings.length === 0) return empty;

    const payments = await this.payments.find({
      where: { bookingId: In(bookings.map((b) => b.id)) },
      order: { createdAt: 'DESC' },
    });

    // Money is added in minor units. Summing the decimal strings directly would
    // drift a paisa at a time and eventually disagree with the ledger below it.
    let held = 0;
    let owed = 0;
    let released = 0;
    let refunded = 0;
    let commission = 0;
    let gross = 0;

    for (const payment of payments) {
      const payout = toMinor(payment.payoutAmount ?? '0');
      const fee = toMinor(payment.commissionAmount ?? '0');
      const total = toMinor(payment.amount ?? '0');

      if (payment.status === PaymentStatus.HELD_IN_ESCROW || payment.status === PaymentStatus.DISPUTED) {
        held += payout;
      }
      // Owed is its own figure, not folded into either side. Counting it as
      // held would say the buyer might still get it back; counting it as
      // released would say the provider has been paid. Neither is true, and a
      // status with no bucket would drop the money out of the totals entirely.
      if (payment.status === PaymentStatus.PENDING_PAYOUT) {
        owed += payout;
        commission += fee;
        gross += total;
      }
      if (payment.status === PaymentStatus.RELEASED || payment.status === PaymentStatus.PARTIALLY_SETTLED) {
        released += payout;
        commission += fee;
        gross += total;
      }
      if (payment.status === PaymentStatus.REFUNDED) {
        refunded += total;
      }
    }

    return {
      heldInEscrow: toMajor(held),
      /** Earned, and not yet transferred. Usually payout onboarding. */
      pendingPayout: toMajor(owed),
      released: toMajor(released),
      refunded: toMajor(refunded),
      commission: toMajor(commission),
      gross: toMajor(gross),
      currency: bookings[0].currency ?? 'INR',
      ledger: payments.map((p) => ({
        paymentId: p.id,
        bookingId: p.bookingId,
        milestone: p.milestone,
        status: p.status,
        amount: p.amount,
        commissionAmount: p.commissionAmount,
        payoutAmount: p.payoutAmount,
        payoutRef: p.payoutRef ?? null,
        payoutNote: p.payoutNote ?? null,
        confirmedAt: p.webhookVerifiedAt ?? null,
        createdAt: p.createdAt,
      })),
    };
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

  /** Whether the advance is in escrow. What opens the booking's chat thread. */
  advanceHeld(bookingId: string): Promise<boolean> {
    return this.hasHeld(bookingId, PaymentMilestone.ADVANCE);
  }

  /**
   * The two accounts a booking is between.
   *
   * The seller is the owner of the listing rather than the listing itself,
   * because a thread is between people. The buyer is the client the booking is
   * *for*, not whoever placed it: an agent who booked on a family's behalf is
   * not the one the vendor needs to reach about their wedding.
   */
  async counterparties(booking: Booking): Promise<{ buyerUserId: string; sellerUserId: string }> {
    const provider = await this.providerOwner(booking.providerType, booking.providerId);
    return { buyerUserId: booking.userId, sellerUserId: provider.ownerUserId };
  }

  /** One booking, loaded and ownership-checked in a single step. */
  async forParticipant(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.loadOrFail(bookingId);
    await this.assertParticipant(actor, booking);
    return booking;
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

  /**
   * A completed job with this provider that has not been reviewed yet.
   *
   * Returns the booking rather than a yes/no, because a review now belongs to
   * a booking: two completed jobs with the same vendor are two experiences and
   * earn two reviews, and one job cannot be reviewed twice. Asking "have they
   * ever bought from this vendor" could only ever answer the first half.
   */
  async unreviewedCompletedBooking(
    userId: string,
    providerType: ProviderType,
    providerId: string,
    reviewedBookingIds: string[],
  ): Promise<Booking | null> {
    const completed = await this.bookings.find({
      where: { userId, providerType, providerId, status: BookingStatus.COMPLETED },
      order: { createdAt: 'DESC' },
    });
    const used = new Set(reviewedBookingIds);
    return completed.find((b) => !used.has(b.id)) ?? null;
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
