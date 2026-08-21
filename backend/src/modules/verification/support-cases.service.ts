import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  SettleCaseDto,
} from './dto/case.dto';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import {
  BookingStatus,
  CaseStatus,
  CaseSubject,
  PaymentStatus,
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

    item.assignedToUserId = officer.id;
    item.allocatedAt = new Date();
    item.status = CaseStatus.ALLOCATED;
    item.history = [
      ...item.history,
      {
        at: new Date().toISOString(),
        byUserId: actor.userId,
        status: CaseStatus.ALLOCATED,
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

    const open = await this.cases.find({
      where: [
        { status: CaseStatus.ALLOCATED },
        { status: CaseStatus.IN_PROGRESS },
        { status: CaseStatus.ESCALATED },
      ],
    });

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
    if (supportCase.status === CaseStatus.RESOLVED || supportCase.status === CaseStatus.CLOSED) {
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
    if (supportCase.status === CaseStatus.RESOLVED || supportCase.status === CaseStatus.CLOSED) {
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
    if (supportCase.status === CaseStatus.RESOLVED || supportCase.status === CaseStatus.CLOSED) {
      throw new BadRequestException('That case is already settled');
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

  async settle(actor: AuthUser, caseId: string, dto: SettleCaseDto): Promise<SupportCase> {
    const item = await this.assignedOrAdmin(actor, caseId);
    if (item.status === CaseStatus.CLOSED) {
      throw new BadRequestException('That case is already closed');
    }
    if (dto.outcome === SettlementOutcome.PARTIAL && !dto.amount) {
      throw new BadRequestException('A partial settlement needs the amount that was settled');
    }

    item.settlementOutcome = dto.outcome;
    item.settlementAmount = dto.amount ? dto.amount.toFixed(2) : null;
    item.settlementNotes = dto.notes ?? null;
    item.status = CaseStatus.RESOLVED;
    item.closedAt = new Date();
    item.closedByUserId = actor.userId;
    item.history = [
      ...item.history,
      {
        at: new Date().toISOString(),
        byUserId: actor.userId,
        status: CaseStatus.RESOLVED,
        note: `${dto.outcome}${dto.amount ? ` ${dto.amount}` : ''}`,
      },
    ];
    const saved = await this.cases.save(item);

    if (item.subjectId && item.subjectType === CaseSubject.BOOKING) {
      await this.applySettlement(item.subjectId, dto.outcome);

      // Where the booking lands follows the money. A refund means the job did
      // not happen; anything else means it carries on from wherever the dispute
      // interrupted it — a case raised mid-job ends with the job still mid-job.
      const restored =
        dto.outcome === SettlementOutcome.REFUND
          ? BookingStatus.CANCELLED
          : ((item.bookingPreviousStatus as BookingStatus | null) ?? BookingStatus.COMPLETED);
      await this.markBooking(item.subjectId, restored);
    }

    await this.audit.record({
      action: AuditAction.CASE_SETTLED,
      actor,
      resourceType: 'support_case',
      resourceId: caseId,
      metadata: {
        outcome: dto.outcome,
        amount: dto.amount ?? null,
        subjectId: item.subjectId,
      },
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

  async close(actor: AuthUser, caseId: string): Promise<SupportCase> {
    const item = await this.assignedOrAdmin(actor, caseId);
    item.status = CaseStatus.CLOSED;
    item.closedAt = item.closedAt ?? new Date();
    item.closedByUserId = actor.userId;
    item.history = [
      ...item.history,
      { at: new Date().toISOString(), byUserId: actor.userId, status: CaseStatus.CLOSED },
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
      where: [
        { subjectId: bookingId, status: CaseStatus.OPEN },
        { subjectId: bookingId, status: CaseStatus.ALLOCATED },
        { subjectId: bookingId, status: CaseStatus.IN_PROGRESS },
        { subjectId: bookingId, status: CaseStatus.ESCALATED },
      ],
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
