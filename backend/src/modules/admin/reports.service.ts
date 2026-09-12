import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Not, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { ServiceDefinition } from '../catalog/entities/service-definition.entity';
import { ServiceCategory } from '../catalog/entities/service-category.entity';
import { SupportCase } from '../verification/entities/support-case.entity';
import { VerificationRequest } from '../verification/entities/verification-request.entity';
import { Dispute } from './entities/dispute.entity';
import {
  ApplicantType,
  BookingStatus,
  CaseStatus,
  CaseSubject,
  DisputeStatus,
  PaymentMilestone,
  PaymentStatus,
  ProviderType,
  VerificationStatus,
} from '../../common/enums';

/**
 * The payment states at which a buyer's money was actually taken.
 *
 * "Collected" used to add up every payment row, including ones still at
 * `initiated` and ones that `failed` -- neither of which moved a rupee. There
 * are none of either today, so the headline has not been wrong yet; it would
 * have been the first time a card was declined (EZ1-I242).
 */
export const MONEY_TAKEN: readonly PaymentStatus[] = [
  PaymentStatus.HELD_IN_ESCROW,
  PaymentStatus.DISPUTED,
  PaymentStatus.RELEASED,
  PaymentStatus.PENDING_PAYOUT,
  PaymentStatus.REFUNDED,
  PaymentStatus.PARTIALLY_SETTLED,
];

/** Verification states in which somebody still has to act. */
const IN_FLIGHT: readonly VerificationStatus[] = [
  VerificationStatus.ASSIGNED,
  VerificationStatus.IN_PROGRESS,
  VerificationStatus.SUBMITTED,
  VerificationStatus.ADMIN_REVIEW,
  VerificationStatus.ADDITIONAL_REVIEW,
  VerificationStatus.ISSUE,
];

/** Case states that end the case, one way or the other. */
const CASE_FINISHED: readonly CaseStatus[] = [
  CaseStatus.RESOLVED,
  CaseStatus.REJECTED,
  CaseStatus.CLOSED,
];

const money = (n: number) => n.toFixed(2);

/** The middle value, to one decimal. A mean is dragged by the one case left for a month. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.floor(sorted.length / 2)].toFixed(1));
}

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The report kinds the Reports dashboard added (EZ1-I242).
 *
 * Kept apart from AdminConsoleService, which was already three times the size
 * a file should be. `report()` there still owns the window -- it resolves the
 * dates once and hands them here -- so every kind reads the same period the
 * same way, which is the whole reason they share one route.
 *
 * Every figure is an aggregate of real rows. Nothing is estimated, and where a
 * number is only partly knowable the response says how much of it was known.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly paymentRows: Repository<Payment>,
    @InjectRepository(VendorService) private readonly vendorServices: Repository<VendorService>,
    @InjectRepository(ServiceDefinition)
    private readonly definitions: Repository<ServiceDefinition>,
    @InjectRepository(ServiceCategory) private readonly categoryRows: Repository<ServiceCategory>,
    @InjectRepository(SupportCase) private readonly caseRows: Repository<SupportCase>,
    @InjectRepository(VerificationRequest)
    private readonly verificationRows: Repository<VerificationRequest>,
    @InjectRepository(Dispute) private readonly disputeRows: Repository<Dispute>,
  ) {}

  /** Every transaction in the window, by state, by instalment and by where the money went. */
  async payments(from: Date, to: Date) {
    const rows = await this.paymentRows.find({ where: { createdAt: Between(from, to) } });

    const count = (status: PaymentStatus) => rows.filter((p) => p.status === status).length;
    const sum = (status: PaymentStatus, column: 'amount' | 'payoutAmount' | 'commissionAmount') =>
      money(
        rows.filter((p) => p.status === status).reduce((t, p) => t + Number(p[column] ?? 0), 0),
      );

    const byStatus: Record<string, { count: number; amount: string }> = {};
    for (const status of Object.values(PaymentStatus)) {
      byStatus[status] = { count: count(status), amount: sum(status, 'amount') };
    }

    const byMilestone: Record<string, { count: number; amount: string }> = {};
    for (const milestone of Object.values(PaymentMilestone)) {
      const inMilestone = rows.filter((p) => p.milestone === milestone);
      byMilestone[milestone] = {
        count: inMilestone.length,
        amount: money(inMilestone.reduce((t, p) => t + Number(p.amount), 0)),
      };
    }

    return {
      transactions: rows.length,
      successful: rows.filter((p) => MONEY_TAKEN.includes(p.status)).length,
      pending: count(PaymentStatus.INITIATED),
      failed: count(PaymentStatus.FAILED),
      refunded: count(PaymentStatus.REFUNDED),
      disputed: count(PaymentStatus.DISPUTED),
      byStatus,
      byMilestone,
      amounts: {
        collected: money(
          rows.filter((p) => MONEY_TAKEN.includes(p.status)).reduce((t, p) => t + Number(p.amount), 0),
        ),
        // The same five definitions the admin dashboard's escrow position uses,
        // so the two pages cannot disagree about where the money is.
        held: sum(PaymentStatus.HELD_IN_ESCROW, 'amount'),
        released: sum(PaymentStatus.RELEASED, 'payoutAmount'),
        commission: sum(PaymentStatus.RELEASED, 'commissionAmount'),
        refunded: sum(PaymentStatus.REFUNDED, 'amount'),
        disputed: sum(PaymentStatus.DISPUTED, 'amount'),
        awaitingPayout: sum(PaymentStatus.PENDING_PAYOUT, 'payoutAmount'),
        partiallySettled: sum(PaymentStatus.PARTIALLY_SETTLED, 'amount'),
      },
    };
  }

  /**
   * How each vendor and planner did with the bookings placed in the window.
   *
   * "Collected" is money actually taken on those bookings, whenever it was
   * taken -- a booking placed in the window and paid a week later still counts,
   * because the question is how that work went, not what arrived on which day.
   */
  async providers(from: Date, to: Date) {
    const rows = await this.bookings.find({
      where: { createdAt: Between(from, to) },
      select: ['id', 'providerType', 'providerId', 'status', 'amount'],
    });
    if (rows.length === 0) return { rows: [] };

    const paid = await this.paymentRows.find({
      where: { bookingId: In(rows.map((r) => r.id)), status: In([...MONEY_TAKEN]) },
      select: ['bookingId', 'amount'],
    });
    const collectedByBooking = new Map<string, number>();
    for (const p of paid) {
      collectedByBooking.set(p.bookingId, (collectedByBooking.get(p.bookingId) ?? 0) + Number(p.amount));
    }

    const vendorIds = [...new Set(rows.filter((r) => r.providerType === ProviderType.VENDOR).map((r) => r.providerId))];
    const plannerIds = [...new Set(rows.filter((r) => r.providerType === ProviderType.PLANNER).map((r) => r.providerId))];
    const [vendors, planners, categories] = await Promise.all([
      vendorIds.length ? this.vendors.find({ where: { id: In(vendorIds) } }) : Promise.resolve([]),
      plannerIds.length ? this.planners.find({ where: { id: In(plannerIds) } }) : Promise.resolve([]),
      this.categoryRows.find({ select: ['slug', 'name'] }),
    ]);
    const categoryName = new Map(categories.map((c) => [c.slug, c.name]));
    const vendorById = new Map(vendors.map((v) => [v.id, v]));
    const plannerById = new Map(planners.map((p) => [p.id, p]));

    type Row = {
      providerType: ProviderType;
      providerId: string;
      name: string;
      category: string;
      city: string | null;
      rating: number | null;
      ratingCount: number;
      bookings: number;
      completed: number;
      cancelled: number;
      value: number;
      collected: number;
    };
    const grouped = new Map<string, Row>();

    for (const b of rows) {
      const key = `${b.providerType}:${b.providerId}`;
      let row = grouped.get(key);
      if (!row) {
        const vendor = b.providerType === ProviderType.VENDOR ? vendorById.get(b.providerId) : undefined;
        const planner = b.providerType === ProviderType.PLANNER ? plannerById.get(b.providerId) : undefined;
        row = {
          providerType: b.providerType,
          providerId: b.providerId,
          name: vendor?.name ?? planner?.agencyName ?? 'A removed listing',
          category: vendor
            ? (categoryName.get(vendor.category) ?? titleCase(vendor.category))
            : (categoryName.get('planning') ?? 'Wedding Planner'),
          city: vendor?.city ?? planner?.city ?? null,
          rating: vendor?.ratingCount || planner?.ratingCount ? Number(vendor?.ratingAvg ?? planner?.ratingAvg) : null,
          ratingCount: vendor?.ratingCount ?? planner?.ratingCount ?? 0,
          bookings: 0,
          completed: 0,
          cancelled: 0,
          value: 0,
          collected: 0,
        };
        grouped.set(key, row);
      }
      row.bookings += 1;
      if (b.status === BookingStatus.COMPLETED) row.completed += 1;
      if (b.status === BookingStatus.CANCELLED) row.cancelled += 1;
      // A cancelled booking was never going to be paid for, and counting its
      // quoted price would credit the provider with work that did not happen.
      else row.value += Number(b.amount);
      row.collected += collectedByBooking.get(b.id) ?? 0;
    }

    return {
      rows: [...grouped.values()]
        .map((r) => ({
          ...r,
          value: money(r.value),
          collected: money(r.collected),
          completionRate: Number(((r.completed / r.bookings) * 100).toFixed(1)),
          cancellationRate: Number(((r.cancelled / r.bookings) * 100).toFixed(1)),
        }))
        .sort((a, b) => b.bookings - a.bookings || Number(b.value) - Number(a.value))
        .slice(0, 100),
    };
  }

  /**
   * Bookings by service category.
   *
   * A booking names its catalogue service only some of the time -- 35 of the 93
   * on this stack do. The rest are attributed through the vendor's own trade,
   * mapped onto the same catalogue category by its slug so "photography" and
   * "Wedding Photographer" are one row rather than two. The response says how
   * many were labelled each way, so the chart cannot claim more precision than
   * the data has.
   */
  async categories(from: Date, to: Date) {
    const rows = await this.bookings.find({
      where: { createdAt: Between(from, to) },
      select: ['id', 'providerType', 'providerId', 'vendorServiceId', 'status', 'amount'],
    });
    if (rows.length === 0) return { rows: [], fromService: 0, inferred: 0 };

    const serviceIds = [...new Set(rows.map((r) => r.vendorServiceId).filter((id): id is string => Boolean(id)))];
    const services = serviceIds.length
      ? await this.vendorServices.find({ where: { id: In(serviceIds) }, select: ['id', 'definitionId'] })
      : [];
    const definitionIds = [...new Set(services.map((s) => s.definitionId))];
    const vendorIds = [
      ...new Set(
        rows
          .filter((r) => r.providerType === ProviderType.VENDOR && !r.vendorServiceId)
          .map((r) => r.providerId),
      ),
    ];

    const [definitions, categories, vendors] = await Promise.all([
      definitionIds.length
        ? this.definitions.find({ where: { id: In(definitionIds) }, select: ['id', 'categoryId'] })
        : Promise.resolve([]),
      this.categoryRows.find({ select: ['id', 'slug', 'name'] }),
      vendorIds.length
        ? this.vendors.find({ where: { id: In(vendorIds) }, select: ['id', 'category'] })
        : Promise.resolve([]),
    ]);

    const definitionOf = new Map(services.map((s) => [s.id, s.definitionId]));
    const categoryOfDefinition = new Map(definitions.map((d) => [d.id, d.categoryId]));
    const categoryById = new Map(categories.map((c) => [c.id, c.name]));
    const categoryBySlug = new Map(categories.map((c) => [c.slug, c.name]));
    const vendorCategory = new Map(vendors.map((v) => [v.id, v.category]));

    let fromService = 0;
    let inferred = 0;
    const grouped = new Map<string, { category: string; bookings: number; completed: number; value: number }>();

    for (const b of rows) {
      let label: string | undefined;
      if (b.vendorServiceId) {
        const definitionId = definitionOf.get(b.vendorServiceId);
        const categoryId = definitionId ? categoryOfDefinition.get(definitionId) : undefined;
        label = categoryId ? categoryById.get(categoryId) : undefined;
        if (label) fromService += 1;
      }
      if (!label) {
        if (b.providerType === ProviderType.PLANNER) {
          label = categoryBySlug.get('planning') ?? 'Wedding Planner';
        } else {
          const trade = vendorCategory.get(b.providerId);
          label = trade ? (categoryBySlug.get(trade) ?? titleCase(trade)) : 'Uncategorised';
        }
        inferred += 1;
      }

      const row = grouped.get(label) ?? { category: label, bookings: 0, completed: 0, value: 0 };
      row.bookings += 1;
      if (b.status === BookingStatus.COMPLETED) row.completed += 1;
      if (b.status !== BookingStatus.CANCELLED) row.value += Number(b.amount);
      grouped.set(label, row);
    }

    return {
      rows: [...grouped.values()]
        .map((r) => ({ ...r, value: money(r.value) }))
        .sort((a, b) => b.bookings - a.bookings),
      fromService,
      inferred,
    };
  }

  /**
   * Support cases and disputes raised in the window.
   *
   * These are two different tables and two different things -- a case is an
   * investigation an officer works, a dispute is a buyer contesting a booking
   * -- so they are reported side by side and never added together.
   */
  async support(from: Date, to: Date) {
    const window = Between(from, to);
    const [cases, disputes] = await Promise.all([
      this.caseRows.find({ where: { createdAt: window } }),
      this.disputeRows.find({ where: { createdAt: window } }),
    ]);

    const caseByStatus: Record<string, number> = {};
    for (const status of Object.values(CaseStatus)) caseByStatus[status] = 0;
    for (const c of cases) caseByStatus[c.status] += 1;

    const bySubject: Record<string, number> = {};
    for (const subject of Object.values(CaseSubject)) bySubject[subject] = 0;
    for (const c of cases) bySubject[c.subjectType] += 1;

    const disputeByStatus: Record<string, number> = {};
    for (const status of Object.values(DisputeStatus)) disputeByStatus[status] = 0;
    for (const d of disputes) disputeByStatus[d.status] += 1;

    return {
      cases: cases.length,
      // "Open" means exactly what the Support inbox's Open chip means.
      open: caseByStatus[CaseStatus.OPEN],
      unresolved: cases.filter((c) => !CASE_FINISHED.includes(c.status)).length,
      escalated: caseByStatus[CaseStatus.ESCALATED],
      resolved: caseByStatus[CaseStatus.RESOLVED],
      closed: caseByStatus[CaseStatus.CLOSED],
      caseByStatus,
      bySubject,
      // To resolution rather than to closure: closure waits on the complainant,
      // and would report their silence as the platform being slow.
      medianHoursToResolution: median(
        cases
          .filter((c) => c.resolvedAt)
          .map((c) => (c.resolvedAt!.getTime() - c.createdAt.getTime()) / 3_600_000),
      ),
      disputes: disputes.length,
      openDisputes: disputeByStatus[DisputeStatus.OPEN],
      disputeByStatus,
    };
  }

  /**
   * Verification requests raised in the window, and the officers' queues now.
   *
   * Workload is deliberately not windowed: it answers "who is carrying what
   * today", and a request allocated last month and still open is part of an
   * officer's load whatever dates are selected.
   */
  async verification(from: Date, to: Date) {
    const rows = await this.verificationRows.find({ where: { createdAt: Between(from, to) } });

    const byStatus: Record<string, number> = {};
    for (const status of Object.values(VerificationStatus)) byStatus[status] = 0;
    for (const r of rows) byStatus[r.status] += 1;

    const byApplicantType: Record<string, { requests: number; approved: number; rejected: number; pending: number }> = {};
    for (const type of Object.values(ApplicantType)) {
      const ofType = rows.filter((r) => r.applicantType === type);
      byApplicantType[type] = {
        requests: ofType.length,
        approved: ofType.filter((r) => r.status === VerificationStatus.APPROVED).length,
        rejected: ofType.filter((r) => r.status === VerificationStatus.REJECTED).length,
        pending: ofType.filter(
          (r) => r.status === VerificationStatus.NEW || IN_FLIGHT.includes(r.status),
        ).length,
      };
    }

    const open = await this.verificationRows.find({
      where: { status: In([...IN_FLIGHT]), assignedToUserId: Not(IsNull()) },
      select: ['assignedToUserId'],
    });
    const load = new Map<string, number>();
    for (const r of open) load.set(r.assignedToUserId!, (load.get(r.assignedToUserId!) ?? 0) + 1);
    const officers = load.size
      ? await this.users.find({ where: { id: In([...load.keys()]) }, select: ['id', 'email'] })
      : [];
    const emailOf = new Map(officers.map((o) => [o.id, o.email]));

    return {
      requests: rows.length,
      // Nobody has been sent to look yet: the administrator's own backlog.
      pending: byStatus[VerificationStatus.NEW],
      inFlight: rows.filter((r) => IN_FLIGHT.includes(r.status)).length,
      approved: byStatus[VerificationStatus.APPROVED],
      rejected: byStatus[VerificationStatus.REJECTED],
      byStatus,
      byApplicantType,
      medianHoursToDecision: median(
        rows
          .filter((r) => r.decidedAt)
          .map((r) => (r.decidedAt!.getTime() - r.createdAt.getTime()) / 3_600_000),
      ),
      officerWorkload: [...load.entries()]
        .map(([officerId, openRequests]) => ({
          officerId,
          email: emailOf.get(officerId) ?? null,
          open: openRequests,
        }))
        .sort((a, b) => b.open - a.open),
    };
  }
}
