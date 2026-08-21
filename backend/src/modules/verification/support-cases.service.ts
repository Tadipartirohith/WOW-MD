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
    private readonly audit: AuditService,
  ) {}

  async raise(actor: AuthUser, dto: RaiseCaseDto): Promise<SupportCase> {
    // Read where the booking stands before freezing it, so the settlement can
    // put it back rather than guess.
    const frozen =
      dto.subjectId && dto.subjectType === CaseSubject.BOOKING
        ? await this.bookings.findOne({ where: { id: dto.subjectId } })
        : null;

    const created = await this.cases.save(
      this.cases.create({
        subjectType: dto.subjectType,
        subjectId: dto.subjectId ?? null,
        raisedByUserId: actor.userId,
        title: dto.title,
        description: dto.description,
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
    const officer = await this.users.findOne({ where: { id: dto.officerUserId } });
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
