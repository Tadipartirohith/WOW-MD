import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SupportCase } from './entities/support-case.entity';
import { BusinessLifecycleService } from '../vendors/business-lifecycle.service';
import { canTransition } from '../vendors/business-lifecycle';
import { User } from '../auth/entities/user.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { VendorAvailabilitySlot } from '../vendors/entities/vendor-availability-slot.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { Profile } from '../users/entities/profile.entity';
import {
  AllocateCaseDto,
  CaseQueryDto,
  RaiseCaseDto,
  RecordFindingsDto,
  ReviewCaseDto,
  SettleCaseDto,
  TriageCaseDto,
} from './dto/case.dto';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import {
  BookingStatus,
  BusinessStatus,
  CasePriority,
  CaseStatus,
  CaseSubject,
  NotificationType,
  PaymentStatus,
  ProviderType,
  SettlementOutcome,
  UserRole,
} from '../../common/enums';

/**
 * The one resolution action that does more than record itself: reopening a
 * vendor's listing for editing (EZ1-I181). Kept as a constant because both the
 * settle path and the side-effect in applyDecision have to agree on the string.
 */
const UNLOCK_LISTING = 'unlock_listing';

/**
 * Issues and disputes, and the investigation that settles them.
 *
 * The important property is that raising a case against a payment **freezes
 * it**: the money stays in escrow, and neither the buyer nor the provider can
 * move it, until a settlement decision is recorded. That is what makes escrow
 * meaningful rather than decorative.
 */
/**
 * States where there is nothing left to do to a case.
 *
 * RESOLVED is *not* one of them. The platform has finished with a resolved
 * case, but the complainant has not necessarily agreed, and there is still one
 * thing left to happen to it — them closing it, or the acknowledgement window
 * running out.
 */
const TERMINAL: CaseStatus[] = [CaseStatus.CLOSED, CaseStatus.REJECTED];

/**
 * Every state in which a case is still holding something up.
 *
 * Written as the complement of "finished" rather than as a list of the states
 * that count, because the list-of-states version was already wrong:
 * WAITING_FOR_INFORMATION was missing from it, so a case parked on a
 * complainant who owed a receipt did not read as open — and the booking it had
 * frozen could be completed or cancelled out from under it, unfreezing money
 * an officer was still deciding about. Derived this way, a state added later
 * counts as open until somebody deliberately says otherwise.
 */
const IN_FLIGHT: CaseStatus[] = Object.values(CaseStatus).filter(
  (status) => !TERMINAL.includes(status) && status !== CaseStatus.RESOLVED,
);

@Injectable()
export class SupportCasesService {
  constructor(
    @InjectRepository(SupportCase) private readonly cases: Repository<SupportCase>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(VendorAvailabilitySlot)
    private readonly slots: Repository<VendorAvailabilitySlot>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    // Reopening a locked listing to resolve a "My Business Listing" case is a
    // real state change, so it goes through the one writer for a business's
    // status rather than being poked from here (EZ1-I181). forwardRef because
    // the two modules already reference each other.
    @Inject(forwardRef(() => BusinessLifecycleService))
    private readonly lifecycle: BusinessLifecycleService,
  ) {}

  /**
   * Append a history entry, unless it would only repeat the last one (EZ1-I193).
   *
   * The timeline records an *actual* state change, not every write. A step that
   * re-states the current status with nothing new to say — same status, same
   * note — must be a no-op, or a case re-saved a few times ends up with the same
   * line six times over with identical timestamps. A genuine transition, or the
   * same status carrying a different note (a re-assignment to another officer,
   * say), still records its own entry.
   */
  private pushHistory(
    item: SupportCase,
    entry: { at: string; byUserId: string; status: string; note?: string },
  ): void {
    const last = item.history[item.history.length - 1];
    if (
      last &&
      last.status === entry.status &&
      (last.note ?? null) === (entry.note ?? null)
    ) {
      return;
    }
    item.history = [...item.history, entry];
  }

  /**
   * Decorate cases with who raised them and, for a booking or payment case, the
   * booking and both parties (EZ1-I74). An administrator investigating a dispute
   * then has the who and the what in front of them instead of a bare complaint.
   */
  private async withContext(rows: SupportCase[]): Promise<SupportCase[]> {
    if (rows.length === 0) return rows;

    // Raiser identity: account plus display name.
    const raiserIds = [...new Set(rows.map((r) => r.raisedByUserId).filter(Boolean))] as string[];
    const [raiserUsers, raiserProfiles] = await Promise.all([
      raiserIds.length
        ? this.users.find({
            where: { id: In(raiserIds) },
            select: ['id', 'email', 'role', 'isActive'],
          })
        : [],
      raiserIds.length ? this.profiles.find({ where: { userId: In(raiserIds) } }) : [],
    ]);
    const userById = new Map(raiserUsers.map((u) => [u.id, u]));
    const nameByUser = new Map(raiserProfiles.map((p) => [p.userId, p.displayName]));

    // BOOKING and PAYMENT cases both carry a booking id in subjectId: the
    // support form asks for a booking reference, and the settlement-request flow
    // stores the booking directly. (Previously PAYMENT subjectIds were looked up
    // as payment ids and never matched, so payout cases showed no context —
    // EZ1-I149.)
    const allBookingIds = [
      ...new Set(
        rows
          .filter(
            (r) =>
              (r.subjectType === CaseSubject.BOOKING ||
                r.subjectType === CaseSubject.PAYMENT) &&
              r.subjectId,
          )
          .map((r) => r.subjectId as string),
      ),
    ];
    const bookings = allBookingIds.length
      ? await this.bookings.find({ where: { id: In(allBookingIds) } })
      : [];
    const bookingById = new Map(bookings.map((b) => [b.id, b]));

    // The escrow breakdown behind those bookings, so a payout case shows the
    // officer the money it is actually about — held, released, refunded or stuck
    // — and not just the booking total (EZ1-I149).
    const bookingPayments = allBookingIds.length
      ? await this.payments.find({ where: { bookingId: In(allBookingIds) } })
      : [];
    const paymentsByBooking = new Map<string, Payment[]>();
    for (const p of bookingPayments) {
      const list = paymentsByBooking.get(p.bookingId) ?? [];
      list.push(p);
      paymentsByBooking.set(p.bookingId, list);
    }

    // Party names for those bookings: buyer display name, and the provider's
    // business name resolved per provider type.
    const buyerIds = [...new Set(bookings.map((b) => b.userId).filter(Boolean))] as string[];
    const buyerProfiles = buyerIds.length
      ? await this.profiles.find({ where: { userId: In(buyerIds) } })
      : [];
    const buyerNameByUser = new Map(buyerProfiles.map((p) => [p.userId, p.displayName]));
    const vendorIds = bookings
      .filter((b) => b.providerType === ProviderType.VENDOR)
      .map((b) => b.providerId);
    const plannerIds = bookings
      .filter((b) => b.providerType !== ProviderType.VENDOR)
      .map((b) => b.providerId);
    const [providerVendors, providerPlanners] = await Promise.all([
      vendorIds.length ? this.vendors.find({ where: { id: In(vendorIds) } }) : [],
      plannerIds.length ? this.planners.find({ where: { id: In(plannerIds) } }) : [],
    ]);
    const vendorNameById = new Map(providerVendors.map((v) => [v.id, v.name]));
    const plannerNameById = new Map(providerPlanners.map((p) => [p.id, p.agencyName]));

    for (const row of rows) {
      const user = row.raisedByUserId ? userById.get(row.raisedByUserId) : null;
      row.raisedByName = row.raisedByUserId ? (nameByUser.get(row.raisedByUserId) ?? null) : null;
      row.raisedByEmail = user?.email ?? null;
      row.raisedByRole = user?.role ?? null;

      const bookingId =
        row.subjectType === CaseSubject.BOOKING ||
        row.subjectType === CaseSubject.PAYMENT
          ? row.subjectId
          : null;
      const booking = bookingId ? bookingById.get(bookingId) : null;
      row.booking = booking
        ? {
            id: booking.id,
            status: booking.status,
            amount: booking.amount,
            currency: booking.currency,
            buyerName: booking.userId ? (buyerNameByUser.get(booking.userId) ?? null) : null,
            providerName:
              booking.providerType === ProviderType.VENDOR
                ? (vendorNameById.get(booking.providerId) ?? null)
                : (plannerNameById.get(booking.providerId) ?? null),
          }
        : null;

      // Escrow breakdown for a booking or payout case.
      const casePayments = bookingId ? paymentsByBooking.get(bookingId) : null;
      row.payments =
        casePayments && casePayments.length
          ? casePayments.map((p) => ({
              milestone: p.milestone,
              status: p.status,
              amount: p.amount,
              payoutAmount: p.payoutAmount,
              payoutNote: p.payoutNote,
            }))
          : null;
    }

    await this.enrichSubjectContext(rows, userById);
    return rows;
  }

  /**
   * Context for the cases that are not about a booking — a business listing, the
   * vendor's availability, or their account (EZ1-I149). The support form does
   * not collect a subject id for these, so each is resolved from the account
   * that raised it: the officer opening an availability complaint sees the slots
   * and their conflicts, a listing complaint sees the compliance row, and an
   * account complaint sees whether the account is even still active.
   */
  private async enrichSubjectContext(
    rows: SupportCase[],
    userById: Map<string, User>,
  ): Promise<void> {
    const businessCases = rows.filter(
      (r) =>
        r.subjectType === CaseSubject.VENDOR ||
        r.subjectType === CaseSubject.AVAILABILITY,
    );
    const ownerIds = [
      ...new Set(businessCases.map((r) => r.raisedByUserId).filter(Boolean)),
    ] as string[];
    const ownedVendors = ownerIds.length
      ? await this.vendors.find({ where: { ownerUserId: In(ownerIds) } })
      : [];
    const vendorByOwner = new Map(ownedVendors.map((v) => [v.ownerUserId, v]));

    // Upcoming slots for those vendors, so an availability complaint can show
    // the windows and any that are overbooked.
    const today = new Date().toISOString().slice(0, 10);
    const vendorIds = ownedVendors.map((v) => v.id);
    const upcomingSlots = vendorIds.length
      ? await this.slots.find({
          where: {
            providerType: ProviderType.VENDOR,
            providerId: In(vendorIds),
          },
        })
      : [];
    const slotsByVendor = new Map<string, VendorAvailabilitySlot[]>();
    for (const s of upcomingSlots) {
      if (s.date < today) continue;
      const list = slotsByVendor.get(s.providerId) ?? [];
      list.push(s);
      slotsByVendor.set(s.providerId, list);
    }

    for (const row of rows) {
      if (row.subjectType === CaseSubject.ACCOUNT) {
        const user = row.raisedByUserId ? userById.get(row.raisedByUserId) : null;
        row.account = user
          ? { email: user.email ?? null, role: user.role ?? null, isActive: user.isActive }
          : null;
        continue;
      }

      const vendor = row.raisedByUserId ? vendorByOwner.get(row.raisedByUserId) : null;
      if (row.subjectType === CaseSubject.VENDOR) {
        row.business = vendor
          ? {
              id: vendor.id,
              name: vendor.name,
              category: vendor.category,
              city: vendor.city ?? null,
              status: vendor.status,
              isApproved: vendor.isApproved,
              gstNumber: vendor.gstNumber,
              panNumber: vendor.panNumber,
              tradingSince: vendor.tradingSince,
              verifiedAt: vendor.verifiedAt,
              decisionReason: vendor.decisionReason,
              revisionCount: vendor.revisionCount,
            }
          : null;
      } else if (row.subjectType === CaseSubject.AVAILABILITY) {
        const slots = vendor ? (slotsByVendor.get(vendor.id) ?? []) : [];
        const ordered = [...slots].sort((a, b) => a.date.localeCompare(b.date));
        row.availability = {
          upcoming: ordered.length,
          conflicts: ordered.filter((s) => s.confirmed > s.capacity).length,
          slots: ordered.slice(0, 10).map((s) => ({
            date: s.date,
            startTime: s.startTime,
            endTime: s.endTime,
            capacity: s.capacity,
            confirmed: s.confirmed,
            pending: s.pending,
            status: s.status,
          })),
        };
      }
    }
  }

  async raise(actor: AuthUser, dto: RaiseCaseDto): Promise<SupportCase> {
    // Read where the booking stands before freezing it, so the settlement can
    // put it back rather than guess.
    //
    // The lookup doubles as a check that the booking exists and is the caller's
    // to dispute. Raising a case freezes escrow, so an unchecked booking id was
    // a way to freeze a stranger's money by guessing a uuid.
    const frozen =
      dto.subjectId && dto.subjectType === CaseSubject.BOOKING
        ? await this.disputableBooking(actor, dto.subjectId)
        : null;

    const created = await this.cases.save(
      this.cases.create({
        subjectType: dto.subjectType,
        subjectId: dto.subjectId ?? null,
        raisedByUserId: actor.userId,
        title: dto.title,
        description: dto.description,
        milestone: dto.milestone ?? null,
        evidence: dto.evidence ?? [],
        status: CaseStatus.OPEN,
        bookingPreviousStatus: frozen?.status ?? null,
        history: [
          { at: new Date().toISOString(), byUserId: actor.userId, status: CaseStatus.OPEN },
        ],
      }),
    );

    // Freeze any escrow attached to the disputed booking, and say so on the
    // booking itself — money and state move together or the two disagree.
    if (dto.subjectId && dto.subjectType === CaseSubject.BOOKING) {
      await this.freezeFundsFor(dto.subjectId);
      await this.markBooking(dto.subjectId, BookingStatus.DISPUTED);
    }

    await this.audit.record({
      action: AuditAction.CASE_RAISED,
      actor,
      resourceType: 'support_case',
      resourceId: created.id,
      metadata: { subjectType: dto.subjectType, subjectId: dto.subjectId ?? null },
    });

    // Tell the administrators a case is waiting, so it lands in their feed and
    // not only in the queue nobody is looking at (EZ1-I49).
    await this.notifications.createForRole(UserRole.ADMIN, NotificationType.DISPUTE_UPDATE, {
      caseId: created.id,
      message: `A ${dto.subjectType} case was raised: ${dto.title}`,
    });
    return created;
  }

  /**
   * "Settle my payment" — a provider asking about money they are owed.
   *
   * Deliberately a support case rather than a workflow of its own. It needs
   * exactly the routing the case desk already has: an administrator looks, and
   * an officer investigates if somebody has to. Building a second pipeline
   * beside that one would be two queues, two sets of states and two places for
   * a request to be forgotten.
   *
   * What it is *not* is a dispute. Nothing is frozen and the booking does not
   * move: the provider is not complaining about the job, they are asking where
   * their money is. Freezing escrow on this would punish them for asking.
   *
   * It answers before it routes. The commonest reason a payout has not landed
   * is a provider who has not finished their own onboarding, and telling them
   * that immediately resolves most of these without anybody being allocated
   * anything.
   */
  async requestSettlement(
    actor: AuthUser,
    bookingId: string,
    note?: string,
  ): Promise<{ case: SupportCase | null; owed: string; reason: string; alreadyOpen: boolean }> {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');

    const ownerUserId = await this.providerOwnerOf(booking);
    if (ownerUserId !== actor.userId && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('That booking was not made against your listing');
    }

    const payments = await this.payments.find({ where: { bookingId } });
    const waiting = payments.filter((p) => p.status === PaymentStatus.PENDING_PAYOUT);
    const held = payments.filter((p) => p.status === PaymentStatus.HELD_IN_ESCROW);
    const owed = waiting
      .reduce((total, p) => total + Number(p.payoutAmount ?? 0), 0)
      .toFixed(2);

    // The specific reason, where there is one. `payoutNote` is what the
    // gateway said when the transfer was refused, and it is the answer the
    // provider is actually looking for.
    const reason = waiting.length
      ? (waiting.find((p) => p.payoutNote)?.payoutNote ??
        'The transfer has not gone through yet. Check the payout account on your business.')
      : held.length
        ? 'The money is still in escrow. It is released when the job is delivered and the balance is paid.'
        : 'There is nothing outstanding on this booking.';

    if (!waiting.length && !held.length) {
      // Nothing owed and nothing held. Raising a case here would put a request
      // on the desk that has no answer except the one just given.
      throw new BadRequestException(reason);
    }

    const existing = await this.cases.findOne({
      where: {
        subjectId: bookingId,
        subjectType: CaseSubject.PAYMENT,
        status: In(IN_FLIGHT),
      },
    });
    if (existing) return { case: existing, owed, reason, alreadyOpen: true };

    const created = await this.cases.save(
      this.cases.create({
        subjectType: CaseSubject.PAYMENT,
        subjectId: bookingId,
        raisedByUserId: actor.userId,
        title: `Settlement requested on booking ${bookingId.slice(0, 8)}`,
        description: note?.trim()
          ? note.trim()
          : `The provider is asking about ${owed} they are owed. ${reason}`,
        evidence: [],
        // Money a provider is waiting on is high priority and does not need a
        // human to decide that, so it arrives triaged.
        status: CaseStatus.TRIAGED,
        priority: CasePriority.HIGH,
        category: 'settlement',
        history: [
          {
            at: new Date().toISOString(),
            byUserId: actor.userId,
            status: CaseStatus.TRIAGED,
            note: `Settlement requested · ${owed} outstanding`,
          },
        ],
      }),
    );

    await this.audit.record({
      action: AuditAction.CASE_RAISED,
      actor,
      resourceType: 'support_case',
      resourceId: created.id,
      metadata: { settlementRequest: true, bookingId, owed },
    });
    return { case: created, owed, reason, alreadyOpen: false };
  }

  /** Which account owns the listing a booking was made against. */
  private async providerOwnerOf(booking: Booking): Promise<string | null> {
    if (booking.providerType === ProviderType.VENDOR) {
      const vendor = await this.vendors.findOne({ where: { id: booking.providerId } });
      return vendor?.ownerUserId ?? null;
    }
    const planner = await this.planners.findOne({ where: { id: booking.providerId } });
    return planner?.ownerUserId ?? null;
  }

  /**
   * Held escrow on the disputed booking is marked disputed, which the booking
   * service treats as un-releasable until a settlement lands.
   */
  /**
   * The booking a dispute is about, if the caller is party to it.
   *
   * Either side may raise one — the buyer whose photographer never arrived, and
   * the vendor who turned up to a locked venue. Nobody else may, because the
   * act of raising freezes the money.
   */
  private async disputableBooking(actor: AuthUser, bookingId: string): Promise<Booking> {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');

    if (actor.role === UserRole.ADMIN) return booking;
    if (booking.userId === actor.userId || booking.bookedByUserId === actor.userId) return booking;

    const [vendor, planner] = await Promise.all([
      this.vendors.findOne({ where: { id: booking.providerId, ownerUserId: actor.userId } }),
      this.planners.findOne({ where: { id: booking.providerId, ownerUserId: actor.userId } }),
    ]);
    if (vendor || planner) return booking;

    throw new ForbiddenException('That booking is not yours to dispute');
  }

  private async freezeFundsFor(bookingId: string): Promise<void> {
    const held = await this.payments.find({
      where: { bookingId, status: PaymentStatus.HELD_IN_ESCROW },
    });
    for (const payment of held) {
      await this.payments.update(payment.id, { status: PaymentStatus.DISPUTED });
    }
  }

  /**
   * Somebody has read it and decided what it is.
   *
   * Priority is set here rather than taken from the complainant, because
   * everybody's own problem is urgent and a queue sorted by self-assessment is
   * sorted by nothing. Category is free text on purpose: the useful buckets are
   * the ones that emerge from real cases, not the ones guessed in advance.
   */
  async triage(actor: AuthUser, caseId: string, dto: TriageCaseDto): Promise<SupportCase> {
    const item = await this.loadOrFail(caseId);
    if (TERMINAL.includes(item.status)) {
      throw new BadRequestException('That case is finished');
    }

    if (dto.priority) item.priority = dto.priority;
    if (dto.category !== undefined) item.category = dto.category ?? null;
    // Only moves the state when nothing has been done yet. Re-triaging a case
    // an officer is already working on should change its priority, not put it
    // back in the queue.
    if (item.status === CaseStatus.OPEN) item.status = CaseStatus.TRIAGED;

    this.pushHistory(item, {
      at: new Date().toISOString(),
      byUserId: actor.userId,
      status: item.status,
      note: dto.note ?? `${item.priority}${item.category ? ` · ${item.category}` : ''}`,
    });
    return this.cases.save(item);
  }

  async allocate(actor: AuthUser, caseId: string, dto: AllocateCaseDto): Promise<SupportCase> {
    const item = await this.loadOrFail(caseId);
    const officerUserId = dto.officerUserId ?? (await this.lightestOfficer());
    if (!officerUserId) {
      throw new BadRequestException('There are no active verification officers to allocate this to');
    }

    const officer = await this.users.findOne({ where: { id: officerUserId } });
    if (!officer || !officer.isActive) throw new NotFoundException('Verification officer not found');
    if (officer.role !== UserRole.IN_PERSON) {
      throw new BadRequestException('Cases can only be allocated to a verification officer');
    }
    // The officer who raised a case cannot be sent to investigate it — that is
    // marking their own homework (EZ1-I98).
    if (item.raisedByUserId && officer.id === item.raisedByUserId) {
      throw new BadRequestException(
        'This case was raised by that officer; allocate it to a different officer.',
      );
    }

    // A case allocated straight from OPEN was read by whoever allocated it, so
    // it has been triaged whether or not anybody pressed the button. Recording
    // that is better than either refusing the allocation or leaving a gap in
    // the history — a required ceremony on an obvious case gets clicked
    // through without being done.
    const wasUntriaged = item.status === CaseStatus.OPEN;
    if (wasUntriaged) {
      this.pushHistory(item, {
        at: new Date().toISOString(),
        byUserId: actor.userId,
        status: CaseStatus.TRIAGED,
        note: 'Triaged on allocation',
      });
    }

    // Round two or later. The second officer needs to know the case has been
    // here before, and an allocation that silently overwrites the first hides
    // that a proposal was refused.
    const returning =
      item.status === CaseStatus.REASSIGNED ||
      item.status === CaseStatus.RESOLUTION_SUBMITTED ||
      item.status === CaseStatus.ADMIN_REVIEW;

    item.assignedToUserId = officer.id;
    item.allocatedAt = new Date();
    item.status = returning ? CaseStatus.REASSIGNED : CaseStatus.ALLOCATED;
    this.pushHistory(item, {
      at: new Date().toISOString(),
      byUserId: actor.userId,
      status: item.status,
      note: dto.note,
    });
    const saved = await this.cases.save(item);

    await this.audit.record({
      action: AuditAction.CASE_ALLOCATED,
      actor,
      resourceType: 'support_case',
      resourceId: caseId,
      metadata: { officerUserId: officer.id },
    });

    // The officer it went to needs to know it is theirs now (EZ1-I49).
    await this.notifications.create(officer.id, NotificationType.DISPUTE_UPDATE, {
      caseId,
      message: `A ${item.subjectType} support case has been allocated to you: ${item.title}`,
    });
    // And the vendor who raised it should see it move rather than sit on OPEN
    // (EZ1-I149 — notify on every transition, not only at resolution).
    await this.notifyRaiser(
      saved,
      returning
        ? `Your ${item.subjectType} case is being looked at again: ${item.title}`
        : `Your ${item.subjectType} case is now with an investigator: ${item.title}`,
    );
    return saved;
  }

  /**
   * Tell whoever raised a case that it moved (EZ1-I149).
   *
   * The lifecycle already told them at resolution; a vendor watching a case
   * should also see it picked up, worked, parked on them for information, or
   * escalated, rather than staring at a status word that never changes until
   * the end. Silent when nobody raised it, and harmless when the raiser is the
   * actor.
   */
  private async notifyRaiser(item: SupportCase, message: string): Promise<void> {
    if (!item.raisedByUserId) return;
    await this.notifications.create(item.raisedByUserId, NotificationType.DISPUTE_UPDATE, {
      caseId: item.id,
      message,
    });
  }

  /**
   * The active officer carrying the fewest open cases. Same idea as the
   * verification queue: an unallocated officer should be the obvious choice,
   * and a query that counts only existing work would never surface them.
   */
  private async lightestOfficer(): Promise<string | null> {
    const officers = await this.users.find({
      where: { role: UserRole.IN_PERSON, isActive: true },
      select: ['id'],
    });
    if (officers.length === 0) return null;

    // An officer's load is everything still on them, which includes the case
    // they are waiting on a complainant for: it is going to come back.
    const open = await this.cases.find({ where: { status: In(IN_FLIGHT) } });

    return officers
      .map((officer) => ({
        id: officer.id,
        load: open.filter((c) => c.assignedToUserId === officer.id).length,
      }))
      .sort((a, b) => a.load - b.load)[0].id;
  }

  async recordFindings(
    actor: AuthUser,
    caseId: string,
    dto: RecordFindingsDto,
  ): Promise<SupportCase> {
    const item = await this.assignedOrAdmin(actor, caseId);
    item.findings = dto.findings;
    item.status = dto.status ?? CaseStatus.IN_PROGRESS;
    this.pushHistory(item, {
      at: new Date().toISOString(),
      byUserId: actor.userId,
      status: item.status,
      note: dto.findings,
    });
    const saved = await this.cases.save(item);
    // The vendor sees it is actively being worked (EZ1-I149). The findings
    // themselves stay internal until an outcome is recorded.
    if (item.status === CaseStatus.IN_PROGRESS) {
      await this.notifyRaiser(saved, `Your ${item.subjectType} case is being looked into: ${item.title}`);
    }
    return saved;
  }

  /**
   * The settlement decision, and the only thing that unfreezes disputed money.
   *
   * Recorded on the case and mirrored onto the payment so the two can never
   * disagree about what was decided.
   */
  /**
   * Marks a case as needing somebody on the ground.
   *
   * Escalation does not reassign or decide anything — it changes what kind of
   * work the case is, so allocation can route it to a field officer instead of
   * leaving it in a queue that will never resolve it. The reason is required:
   * "escalated" with no explanation tells the next person nothing.
   */
  async escalate(actor: AuthUser, id: string, reason: string): Promise<SupportCase> {
    // The assigned officer or an administrator: escalation is now one of the
    // officer's own resolution actions (EZ1-I181), so it is scoped the same way
    // as recording findings rather than being an administrator-only step.
    const supportCase = await this.assignedOrAdmin(actor, id);
    if (TERMINAL.includes(supportCase.status) || supportCase.status === CaseStatus.RESOLVED) {
      throw new BadRequestException('That case is already settled');
    }

    supportCase.requiresPhysicalVerification = true;
    supportCase.status = CaseStatus.ESCALATED;
    this.pushHistory(supportCase, {
      at: new Date().toISOString(),
      byUserId: actor.userId,
      status: CaseStatus.ESCALATED,
      note: reason,
    });

    const saved = await this.cases.save(supportCase);
    await this.audit.record({
      action: AuditAction.CASE_ALLOCATED,
      actor,
      resourceType: 'support_case',
      resourceId: saved.id,
      metadata: { escalated: true, reason },
    });
    // The vendor should know a visit is being arranged rather than that their
    // case has gone quiet (EZ1-I149).
    await this.notifyRaiser(
      saved,
      `Your ${saved.subjectType} case has been escalated for a visit: ${saved.title}`,
    );
    return saved;
  }

  /**
   * Parks a case on the party who owes an answer.
   *
   * Distinct from "in progress" because the clock is not on the officer:
   * reporting the two as one state hides which side is holding everything up,
   * and a queue where nothing distinguishes them stops being a queue.
   */
  async awaitInformation(actor: AuthUser, id: string, note: string): Promise<SupportCase> {
    const supportCase = await this.loadOrFail(id);
    if (TERMINAL.includes(supportCase.status) || supportCase.status === CaseStatus.RESOLVED) {
      throw new BadRequestException('That case is already settled');
    }

    supportCase.status = CaseStatus.WAITING_FOR_INFORMATION;
    this.pushHistory(supportCase, {
      at: new Date().toISOString(),
      byUserId: actor.userId,
      status: CaseStatus.WAITING_FOR_INFORMATION,
      note,
    });
    const saved = await this.cases.save(supportCase);
    // Parking a case on the vendor is worth nothing if they are not told they
    // are the one holding it up (EZ1-I149).
    await this.notifyRaiser(saved, `Your ${saved.subjectType} case needs more from you: ${note}`);
    return saved;
  }

  /** Adds evidence to an open case — proof rarely all arrives at once. */
  async addEvidence(actor: AuthUser, id: string, urls: string[]): Promise<SupportCase> {
    const supportCase = await this.loadOrFail(id);
    // Closed is the bar here rather than resolved, and deliberately: reading
    // the outcome is exactly when a complainant finds the receipt they should
    // have sent in the first place, and refusing it then is how a case gets
    // raised a second time instead.
    if (TERMINAL.includes(supportCase.status)) {
      throw new BadRequestException('That case is closed');
    }
    // Only the person who raised it, or staff, may add to it.
    if (
      supportCase.raisedByUserId !== actor.userId &&
      actor.role !== UserRole.ADMIN &&
      actor.role !== UserRole.IN_PERSON
    ) {
      throw new ForbiddenException('That case is not yours to add to');
    }

    supportCase.evidence = [...new Set([...supportCase.evidence, ...urls])];
    return this.cases.save(supportCase);
  }

  /**
   * Records a settlement decision.
   *
   * Who is calling decides what this *is*. An officer submits a proposal and
   * nothing moves; an administrator makes the decision and the money follows.
   *
   * The separation is the reason there are two roles. An officer who both
   * finds the facts and releases the escrow is one person deciding a payment
   * dispute alone, with nobody to catch it when they get it wrong — and the
   * party it went against has no recourse but to raise another case with the
   * same person. An administrator has nobody above them, so requiring them to
   * approve their own proposal would be ceremony, and they decide in one step.
   */
  async settle(actor: AuthUser, caseId: string, dto: SettleCaseDto): Promise<SupportCase> {
    const item = await this.assignedOrAdmin(actor, caseId);
    if (TERMINAL.includes(item.status)) {
      throw new BadRequestException('That case is already settled');
    }
    if (dto.outcome === SettlementOutcome.PARTIAL && !dto.amount) {
      throw new BadRequestException('A partial settlement needs the amount that was settled');
    }

    item.settlementOutcome = dto.outcome;
    item.settlementAmount = dto.amount ? dto.amount.toFixed(2) : null;
    item.settlementNotes = dto.notes ?? null;
    // The named action the officer chose, if any (EZ1-I181). Says what was done
    // about the complaint, not only what happened to the money.
    item.resolutionAction = dto.action ?? null;
    const actionNote = dto.action ? `${dto.action} · ` : '';

    if (actor.role !== UserRole.ADMIN) {
      // A proposal. On somebody's desk, and the money has not moved.
      item.status = CaseStatus.RESOLUTION_SUBMITTED;
      this.pushHistory(item, {
        at: new Date().toISOString(),
        byUserId: actor.userId,
        status: CaseStatus.RESOLUTION_SUBMITTED,
        note: `${actionNote}Proposes ${dto.outcome}${dto.amount ? ` ${dto.amount}` : ''}`,
      });
      const proposed = await this.cases.save(item);
      await this.audit.record({
        action: AuditAction.CASE_SETTLED,
        actor,
        resourceType: 'support_case',
        resourceId: caseId,
        metadata: { proposed: true, outcome: dto.outcome, amount: dto.amount ?? null },
      });

      // The officer has proposed a resolution; the administrators decide on it
      // and should not have to poll the queue to find it (EZ1-I49).
      await this.notifications.createForRole(UserRole.ADMIN, NotificationType.DISPUTE_UPDATE, {
        caseId,
        message: `An officer submitted a resolution for review: ${item.title}`,
      });
      return proposed;
    }

    return this.applyDecision(actor, item, dto.outcome, dto.amount ?? null);
  }

  /**
   * An administrator answers a proposal: take it, or send it back.
   *
   * Sending it back is not a rejection of the complaint — it is a rejection of
   * the recommendation, which is why it goes to a *different* officer by
   * default rather than to the same one to try again.
   */
  async review(actor: AuthUser, caseId: string, dto: ReviewCaseDto): Promise<SupportCase> {
    const item = await this.loadOrFail(caseId);
    if (
      item.status !== CaseStatus.RESOLUTION_SUBMITTED &&
      item.status !== CaseStatus.ADMIN_REVIEW
    ) {
      throw new BadRequestException('There is no proposal on that case to review');
    }

    if (dto.decision === 'reassign') {
      if (!dto.note) {
        throw new BadRequestException(
          'Say why it is going back — the next officer has to know what was wrong with it',
        );
      }
      // The proposal is cleared rather than kept alongside a new one, so
      // "what does this case recommend" always has exactly one answer.
      item.settlementOutcome = null;
      item.settlementAmount = null;
      item.settlementNotes = null;
      item.resolutionAction = null;
      item.status = CaseStatus.ADMIN_REVIEW;
      await this.cases.save(item);

      return this.allocate(actor, item.id, {
        officerUserId: dto.officerUserId,
        note: dto.note,
      } as AllocateCaseDto);
    }

    if (!item.settlementOutcome) {
      throw new BadRequestException('That proposal has no outcome on it to approve');
    }
    return this.applyDecision(
      actor,
      item,
      item.settlementOutcome,
      item.settlementAmount ? Number(item.settlementAmount) : null,
    );
  }

  /**
   * The one place money moves on a case, whoever authorised it.
   *
   * Shared by an administrator settling directly and one approving an officer's
   * proposal, because the two must do exactly the same thing — two code paths
   * that both release escrow is two places for them to drift.
   */
  private async applyDecision(
    actor: AuthUser,
    item: SupportCase,
    outcome: SettlementOutcome,
    amount: number | null,
  ): Promise<SupportCase> {
    item.settlementOutcome = outcome;
    item.settlementAmount = amount !== null ? amount.toFixed(2) : null;
    item.status = CaseStatus.RESOLVED;
    // Resolved, not closed. The platform has finished; the complainant has not
    // necessarily agreed, and that is a separate fact with its own timestamp.
    item.resolvedAt = new Date();
    item.resolvedByUserId = actor.userId;
    this.pushHistory(item, {
      at: new Date().toISOString(),
      byUserId: actor.userId,
      status: CaseStatus.RESOLVED,
      note: `${outcome}${amount !== null ? ` ${amount}` : ''}`,
    });
    const saved = await this.cases.save(item);

    if (item.subjectId && item.subjectType === CaseSubject.BOOKING) {
      await this.applySettlement(item.subjectId, outcome);

      // Where the booking lands follows the money. A refund means the job did
      // not happen; anything else means it carries on from wherever the dispute
      // interrupted it — a case raised mid-job ends with the job still mid-job.
      const restored =
        outcome === SettlementOutcome.REFUND
          ? BookingStatus.CANCELLED
          : ((item.bookingPreviousStatus as BookingStatus | null) ?? BookingStatus.COMPLETED);
      await this.markBooking(item.subjectId, restored);
    }

    // "Unlock business details" is the one resolution action with a real effect
    // beyond the record: it reopens the vendor's listing for editing so they can
    // fix whatever the case was about (EZ1-I181). Everything else is recorded
    // and the case simply closes.
    if (
      item.subjectType === CaseSubject.VENDOR &&
      item.resolutionAction === UNLOCK_LISTING
    ) {
      await this.unlockListingFor(item, actor);
    }

    await this.audit.record({
      action: AuditAction.CASE_SETTLED,
      actor,
      resourceType: 'support_case',
      resourceId: item.id,
      metadata: { outcome, amount, subjectId: item.subjectId },
    });

    // Tell the person who raised it that it has been resolved, so they open the
    // case and read the outcome rather than wondering whether anything happened
    // (EZ1-I49).
    if (item.raisedByUserId) {
      await this.notifications.create(item.raisedByUserId, NotificationType.DISPUTE_UPDATE, {
        caseId: item.id,
        message: `Your ${item.subjectType} case has been resolved: ${item.title}`,
      });
    }
    return saved;
  }

  /**
   * Reopen the raiser's listing for editing (EZ1-I181).
   *
   * A "My Business Listing" case is raised by the vendor whose listing it is, so
   * the business is resolved from the raiser — these cases carry no subject id.
   * Only a listing the state machine can actually move to REVERIFICATION_REQUIRED
   * is touched; one already editable or rejected is left as it is, and the
   * resolution is still recorded either way.
   */
  private async unlockListingFor(item: SupportCase, actor: AuthUser): Promise<void> {
    if (!item.raisedByUserId) return;
    const vendor = await this.vendors.findOne({
      where: { ownerUserId: item.raisedByUserId },
    });
    if (!vendor) return;
    if (
      !canTransition(vendor.status as BusinessStatus, BusinessStatus.REVERIFICATION_REQUIRED)
    ) {
      return;
    }
    await this.lifecycle.requireReverification(
      vendor.id,
      item.settlementNotes?.trim() ||
        `Listing reopened to resolve support case ${item.id.slice(0, 8)}`,
      actor,
    );
  }

  private async applySettlement(bookingId: string, outcome: SettlementOutcome): Promise<void> {
    const disputed = await this.payments.find({
      where: { bookingId, status: PaymentStatus.DISPUTED },
    });
    for (const payment of disputed) {
      const status =
        outcome === SettlementOutcome.RELEASE
          ? PaymentStatus.RELEASED
          : outcome === SettlementOutcome.REFUND
            ? PaymentStatus.REFUNDED
            : outcome === SettlementOutcome.PARTIAL
              ? PaymentStatus.RELEASED
              : PaymentStatus.HELD_IN_ESCROW;
      await this.payments.update(payment.id, { status });
    }
  }

  /**
   * Moves a disputed booking, either into DISPUTED or back out of it.
   *
   * Deliberately not routed through the booking state machine: freezing and
   * restoring are sideways moves that the forward-only map would refuse, and an
   * officer's settlement is exactly the authority that should be able to make
   * them. Silently does nothing when the id is not a booking — case subjects
   * also cover profiles and matches.
   */
  private async markBooking(bookingId: string, status: BookingStatus): Promise<void> {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) return;
    booking.status = status;
    await this.bookings.save(booking);
  }

  /**
   * The complainant is done with it.
   *
   * Closing is theirs, not the desk's, and that is the whole distinction
   * between RESOLVED and CLOSED. When the two were one state, support marked
   * its own homework: everything looked finished the moment staff stopped
   * working on it, whether or not the person who raised it agreed — and the
   * metric that says how well the desk is doing was computed from that.
   *
   * An administrator can still close one, because somebody has to be able to
   * shut a case whose complainant has stopped answering. It is recorded as
   * their action, and `resolvedAt` stays as it was, so the two facts remain
   * separable afterwards.
   */
  async close(actor: AuthUser, caseId: string): Promise<SupportCase> {
    const item = await this.loadOrFail(caseId);

    const mine = item.raisedByUserId === actor.userId;
    if (!mine && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException(
        'A case is closed by the person who raised it, or by an administrator',
      );
    }
    if (item.status === CaseStatus.CLOSED) return item;
    if (item.status !== CaseStatus.RESOLVED && item.status !== CaseStatus.REJECTED && !mine) {
      throw new BadRequestException(
        'That case has not been decided yet. Resolve it before closing it.',
      );
    }

    item.status = CaseStatus.CLOSED;
    item.closedAt = new Date();
    item.closedByUserId = actor.userId;
    this.pushHistory(item, {
      at: new Date().toISOString(),
      byUserId: actor.userId,
      status: CaseStatus.CLOSED,
      note: mine ? 'Closed by the person who raised it' : 'Closed by an administrator',
    });
    return this.cases.save(item);
  }

  async list(actor: AuthUser, q: CaseQueryDto): Promise<PaginatedResult<SupportCase>> {
    const qb = this.cases.createQueryBuilder('c');

    if (actor.role === UserRole.IN_PERSON) {
      qb.where('c."assignedToUserId" = :me', { me: actor.userId });
    } else if (actor.role === UserRole.ADMIN) {
      qb.where('1 = 1');
    } else {
      // Everyone else sees only what they raised themselves.
      qb.where('c."raisedByUserId" = :me', { me: actor.userId });
    }
    if (q.status) qb.andWhere('c.status = :status', { status: q.status });
    if (q.subjectType) qb.andWhere('c."subjectType" = :st', { st: q.subjectType });

    qb.orderBy('c."createdAt"', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(await this.withContext(data), total, q.page, q.limit);
  }

  async findOne(actor: AuthUser, id: string): Promise<SupportCase> {
    const item = await this.loadOrFail(id);
    const mine =
      item.raisedByUserId === actor.userId || item.assignedToUserId === actor.userId;
    if (!mine && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('That case is not yours');
    }
    const [enriched] = await this.withContext([item]);
    return enriched;
  }

  async metrics(officerUserId?: string): Promise<Record<string, number>> {
    const qb = this.cases
      .createQueryBuilder('c')
      .select('c.status', 'status')
      .addSelect('COUNT(c.id)', 'count');
    if (officerUserId) qb.where('c."assignedToUserId" = :o', { o: officerUserId });
    qb.groupBy('c.status');

    const rows = await qb.getRawMany<{ status: string; count: string }>();
    const out: Record<string, number> = {
      open: 0,
      allocated: 0,
      in_progress: 0,
      resolved: 0,
      rejected: 0,
      escalated: 0,
      closed: 0,
    };
    for (const r of rows) out[r.status] = Number(r.count);
    out.total = Object.values(out).reduce((a, b) => a + b, 0);
    return out;
  }

  /** Does an open case block this booking's money from moving? */
  async hasOpenCaseFor(bookingId: string): Promise<boolean> {
    const count = await this.cases.count({
      where: { subjectId: bookingId, status: In(IN_FLIGHT) },
    });
    return count > 0;
  }

  private async assignedOrAdmin(actor: AuthUser, caseId: string): Promise<SupportCase> {
    const item = await this.loadOrFail(caseId);
    if (actor.role !== UserRole.ADMIN && item.assignedToUserId !== actor.userId) {
      throw new ForbiddenException('That case is not allocated to you');
    }
    return item;
  }

  private async loadOrFail(id: string): Promise<SupportCase> {
    const item = await this.cases.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Case not found');
    return item;
  }
}
