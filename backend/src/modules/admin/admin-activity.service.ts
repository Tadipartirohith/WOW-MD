import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Not, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { SupportCase } from '../verification/entities/support-case.entity';
import { VerificationRequest } from '../verification/entities/verification-request.entity';
import { Dispute } from './entities/dispute.entity';
import { MONEY_TAKEN } from './reports.service';
import { ActivityQueryDto } from './dto/console.dto';
import { VerificationStatus } from '../../common/enums';

/** One line in the activity feed. Deliberately uniform across every source. */
export interface ActivityItem {
  at: Date;
  /** What happened, in the platform's own vocabulary. */
  kind: string;
  /** A sentence somebody can read without opening anything. */
  summary: string;
  resourceType: string;
  resourceId: string;
}

/**
 * The platform activity feed on the admin console.
 *
 * Split out of AdminConsoleService, which had grown past 1,600 lines; the
 * methods moved unchanged.
 */
@Injectable()
export class AdminActivityService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(SupportCase) private readonly cases: Repository<SupportCase>,
    @InjectRepository(VerificationRequest)
    private readonly verifications: Repository<VerificationRequest>,
    // Read-only, for disputes raised in the activity feed (EZ1-I242).
    @InjectRepository(Dispute) private readonly disputes: Repository<Dispute>,
  ) {}

  /**
   * What has been happening, across the whole platform.
   *
   * Distinct from the audit trail, which records *privileged* actions — who
   * approved what, who moved money. This is the ordinary life of the platform:
   * people signing up, listings being submitted, bookings arriving, complaints
   * being raised. An administrator opening the console wants to know whether
   * anything is happening at all before they want to know who did what to whom.
   *
   * Assembled by taking the newest few rows from each source and merging them
   * rather than by a SQL UNION. The union would be one query and several
   * hundred lines of hand-written column aliasing across tables that share
   * almost no shape; this is six small indexed reads on `createdAt` and a sort
   * of at most a few dozen rows. When the feed grows a source, it grows by four
   * lines here instead of by a rewrite.
   */
  async activity(q: ActivityQueryDto): Promise<ActivityItem[]> {
    const take = q.limit;

    /*
     * An optional window over each event's own timestamp -- a booking cancelled
     * today belongs to today even though it was placed last month (EZ1-I242).
     * Without one, every source is simply its newest rows.
     */
    let range: ReturnType<typeof Between<Date>> | undefined;
    if (q.from || q.to) {
      const to = q.to ? new Date(q.to) : new Date();
      to.setHours(23, 59, 59, 999);
      const from = q.from ? new Date(q.from) : new Date(0);
      range = Between(from, to);
    }
    const on = (column: string) => (range ? { [column]: range } : {});
    const happened = (column: string) =>
      range ? { [column]: range } : { [column]: Not(IsNull()) };

    const [
      users,
      listings,
      bookings,
      cases,
      verifications,
      clients,
      planners,
      completed,
      cancelled,
      decided,
      resolved,
      disputes,
      payments,
    ] = await Promise.all([
      this.users.find({
        where: on('createdAt'),
        order: { createdAt: 'DESC' },
        take,
        select: ['id', 'role', 'createdAt'],
      }),
      this.vendors.find({ where: on('createdAt'), order: { createdAt: 'DESC' }, take }),
      this.bookings.find({ where: on('createdAt'), order: { createdAt: 'DESC' }, take }),
      this.cases.find({ where: on('createdAt'), order: { createdAt: 'DESC' }, take }),
      this.verifications.find({ where: on('createdAt'), order: { createdAt: 'DESC' }, take }),
      this.users.find({
        where: { managedByAgentId: Not(IsNull()), ...on('createdAt') },
        order: { createdAt: 'DESC' },
        take,
        select: ['id', 'createdAt'],
      }),
      this.planners.find({ where: on('createdAt'), order: { createdAt: 'DESC' }, take }),
      this.bookings.find({ where: happened('completedAt'), order: { completedAt: 'DESC' }, take }),
      this.bookings.find({ where: happened('cancelledAt'), order: { cancelledAt: 'DESC' }, take }),
      this.verifications.find({
        where: {
          ...happened('decidedAt'),
          status: In([VerificationStatus.APPROVED, VerificationStatus.REJECTED]),
        },
        order: { decidedAt: 'DESC' },
        take,
      }),
      this.cases.find({ where: happened('resolvedAt'), order: { resolvedAt: 'DESC' }, take }),
      this.disputes.find({ where: on('createdAt'), order: { createdAt: 'DESC' }, take }),
      this.payments.find({
        where: { ...on('createdAt'), status: In([...MONEY_TAKEN]) },
        order: { createdAt: 'DESC' },
        take,
      }),
    ]);

    const items: ActivityItem[] = [
      ...users.map((u) => ({
        at: u.createdAt,
        kind: 'account.registered',
        summary: `A ${u.role.replace(/_/g, ' ')} account was created`,
        resourceType: 'user',
        resourceId: u.id,
      })),
      ...listings.map((v) => ({
        at: v.createdAt,
        kind: 'business.created',
        summary: `${v.name} was listed under ${v.category}`,
        resourceType: 'vendor',
        resourceId: v.id,
      })),
      ...bookings.map((b) => ({
        at: b.createdAt,
        kind: 'booking.placed',
        summary: `A booking was placed${b.eventDate ? ` for ${b.eventDate}` : ''}`,
        resourceType: 'booking',
        resourceId: b.id,
      })),
      ...cases.map((c) => ({
        at: c.createdAt,
        kind: 'case.raised',
        // The title is what the complainant wrote, so it is quoted rather than
        // paraphrased — a feed that summarises complaints in its own words is
        // a feed nobody trusts.
        summary: `Case raised: ${c.title}`,
        resourceType: 'support_case',
        resourceId: c.id,
      })),
      ...verifications.map((v) => ({
        at: v.createdAt,
        kind: 'verification.raised',
        summary: `A ${v.applicantType} verification entered the queue`,
        resourceType: 'verification_request',
        resourceId: v.id,
      })),
      ...clients.map((c) => ({
        at: c.createdAt,
        kind: 'client.onboarded',
        summary: 'An agency took on a client',
        resourceType: 'agent_client',
        resourceId: c.id,
      })),
      ...planners.map((p) => ({
        at: p.createdAt,
        kind: 'planner.registered',
        summary: `${p.agencyName} registered as a wedding planner`,
        resourceType: 'planner',
        resourceId: p.id,
      })),
      ...completed.map((b) => ({
        at: b.completedAt as Date,
        kind: 'booking.completed',
        summary: 'A booking was marked complete',
        resourceType: 'booking',
        resourceId: b.id,
      })),
      ...cancelled.map((b) => ({
        at: b.cancelledAt as Date,
        kind: 'booking.cancelled',
        summary: 'A booking was cancelled',
        resourceType: 'booking',
        resourceId: b.id,
      })),
      ...decided.map((v) => ({
        at: v.decidedAt as Date,
        kind:
          v.status === VerificationStatus.APPROVED
            ? 'verification.approved'
            : 'verification.rejected',
        summary: `A ${v.applicantType} verification was ${v.status === VerificationStatus.APPROVED ? 'approved' : 'rejected'}`,
        resourceType: 'verification_request',
        resourceId: v.id,
      })),
      ...resolved.map((c) => ({
        at: c.resolvedAt as Date,
        kind: 'case.resolved',
        summary: `Case resolved: ${c.title}`,
        resourceType: 'support_case',
        resourceId: c.id,
      })),
      ...disputes.map((d) => ({
        at: d.createdAt,
        kind: 'dispute.raised',
        summary: 'A buyer raised a dispute on a booking',
        resourceType: 'dispute',
        resourceId: d.id,
      })),
      ...payments.map((p) => ({
        at: p.createdAt,
        kind: 'payment.received',
        summary: `${p.milestone} payment of ${Number(p.amount).toLocaleString('en-IN')} taken into escrow`,
        resourceType: 'payment',
        resourceId: p.id,
      })),
    ];

    return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take);
  }
}
