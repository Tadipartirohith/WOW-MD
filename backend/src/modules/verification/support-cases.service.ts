import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SupportCase } from './entities/support-case.entity';
import { User } from '../auth/entities/user.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
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
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import {
  BookingStatus,
  CasePriority,
  CaseStatus,
  CaseSubject,
  PaymentStatus,
  ProviderType,
  SettlementOutcome,
  UserRole,
} from '../../common/enums';

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
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    private readonly audit: AuditService,
  ) {}

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

    item.history = [
      ...item.history,
      {
        at: new Date().toISOString(),
        byUserId: actor.userId,
        status: item.status,
        note: dto.note ?? `${item.priority}${item.category ? ` · ${item.category}` : ''}`,
      },
    ];
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

    // A case allocated straight from OPEN was read by whoever allocated it, so
    // it has been triaged whether or not anybody pressed the button. Recording
    // that is better than either refusing the allocation or leaving a gap in
    // the history — a required ceremony on an obvious case gets clicked
    // through without being done.
    const wasUntriaged = item.status === CaseStatus.OPEN;
    if (wasUntriaged) {
      item.history = [
        ...item.history,
        {
          at: new Date().toISOString(),
          byUserId: actor.userId,
          status: CaseStatus.TRIAGED,
          note: 'Triaged on allocation',
        },
      ];
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
    item.history = [
      ...item.history,
      {
        at: new Date().toISOString(),
        byUserId: actor.userId,
        status: item.status,
        note: dto.note,
      },
    ];
    const saved = await this.cases.save(item);

    await this.audit.record({
      action: AuditAction.CASE_ALLOCATED,
      actor,
      resourceType: 'support_case',
      resourceId: caseId,
      metadata: { officerUserId: officer.id },
    });
    return saved;
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
    item.history = [
      ...item.history,
      { at: new Date().toISOString(), byUserId: actor.userId, status: item.status, note: dto.findings },
    ];
    return this.cases.save(item);
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
    const supportCase = await this.loadOrFail(id);
    if (TERMINAL.includes(supportCase.status) || supportCase.status === CaseStatus.RESOLVED) {
      throw new BadRequestException('That case is already settled');
    }

    supportCase.requiresPhysicalVerification = true;
    supportCase.status = CaseStatus.ESCALATED;
    supportCase.history = [
      ...supportCase.history,
      {
        at: new Date().toISOString(),
        byUserId: actor.userId,
        status: CaseStatus.ESCALATED,
        note: reason,
      },
    ];

    const saved = await this.cases.save(supportCase);
    await this.audit.record({
      action: AuditAction.CASE_ALLOCATED,
      actor,
      resourceType: 'support_case',
      resourceId: saved.id,
      metadata: { escalated: true, reason },
    });
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
    supportCase.history = [
      ...supportCase.history,
      {
        at: new Date().toISOString(),
        byUserId: actor.userId,
        status: CaseStatus.WAITING_FOR_INFORMATION,
        note,
      },
    ];
    return this.cases.save(supportCase);
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

    if (actor.role !== UserRole.ADMIN) {
      // A proposal. On somebody's desk, and the money has not moved.
      item.status = CaseStatus.RESOLUTION_SUBMITTED;
      item.history = [
        ...item.history,
        {
          at: new Date().toISOString(),
          byUserId: actor.userId,
          status: CaseStatus.RESOLUTION_SUBMITTED,
          note: `Proposes ${dto.outcome}${dto.amount ? ` ${dto.amount}` : ''}`,
        },
      ];
      const proposed = await this.cases.save(item);
      await this.audit.record({
        action: AuditAction.CASE_SETTLED,
        actor,
        resourceType: 'support_case',
        resourceId: caseId,
        metadata: { proposed: true, outcome: dto.outcome, amount: dto.amount ?? null },
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
    item.history = [
      ...item.history,
      {
        at: new Date().toISOString(),
        byUserId: actor.userId,
        status: CaseStatus.RESOLVED,
        note: `${outcome}${amount !== null ? ` ${amount}` : ''}`,
      },
    ];
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

    await this.audit.record({
      action: AuditAction.CASE_SETTLED,
      actor,
      resourceType: 'support_case',
      resourceId: item.id,
      metadata: { outcome, amount, subjectId: item.subjectId },
    });
    return saved;
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
    item.history = [
      ...item.history,
      {
        at: new Date().toISOString(),
        byUserId: actor.userId,
        status: CaseStatus.CLOSED,
        note: mine ? 'Closed by the person who raised it' : 'Closed by an administrator',
      },
    ];
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
    return paginate(data, total, q.page, q.limit);
  }

  async findOne(actor: AuthUser, id: string): Promise<SupportCase> {
    const item = await this.loadOrFail(id);
    const mine =
      item.raisedByUserId === actor.userId || item.assignedToUserId === actor.userId;
    if (!mine && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('That case is not yours');
    }
    return item;
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
