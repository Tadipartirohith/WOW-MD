import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Not, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { Profile } from '../users/entities/profile.entity';
import { SupportCase } from '../verification/entities/support-case.entity';
import { VerificationRequest } from '../verification/entities/verification-request.entity';
import { AgentCharge } from '../agents/entities/agent-charge.entity';
import {
  ActivityQueryDto,
  AdminBookingQueryDto,
  DirectoryQueryDto,
  ReportQueryDto,
} from './dto/console.dto';
import {
  BookingStatus,
  BusinessStatus,
  CaseStatus,
  NetworkVisibility,
  PaymentStatus,
  ProfileLifecycle,
  UserRole,
  VerificationStatus,
} from '../../common/enums';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';
import { AppConfigService } from '../../config/app-config.service';

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

@Injectable()
export class AdminConsoleService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(SupportCase) private readonly cases: Repository<SupportCase>,
    @InjectRepository(VerificationRequest)
    private readonly verifications: Repository<VerificationRequest>,
    @InjectRepository(AgentCharge) private readonly charges: Repository<AgentCharge>,
    private readonly cfg: AppConfigService,
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

    const [users, listings, bookings, cases, verifications, clients] = await Promise.all([
      this.users.find({ order: { createdAt: 'DESC' }, take, select: ['id', 'role', 'createdAt'] }),
      this.vendors.find({ order: { createdAt: 'DESC' }, take }),
      this.bookings.find({ order: { createdAt: 'DESC' }, take }),
      this.cases.find({ order: { createdAt: 'DESC' }, take }),
      this.verifications.find({ order: { createdAt: 'DESC' }, take }),
      this.users.find({
        where: { managedByAgentId: Not(IsNull()) },
        order: { createdAt: 'DESC' },
        take,
        select: ['id', 'createdAt'],
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
    ];

    return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take);
  }

  /**
   * The accounts directory, filtered the way an administrator actually looks.
   *
   * `listUsers` already pages by role. What it could not do is answer "show me
   * the suspended ones" or "find this email", which is how somebody arrives
   * here — from a complaint naming a person, not from a wish to browse.
   */
  async directory(q: DirectoryQueryDto): Promise<PaginatedResult<Record<string, unknown>>> {
    const qb = this.users
      .createQueryBuilder('u')
      .select([
        'u.id',
        'u.email',
        'u.role',
        'u.isActive',
        'u.isVerified',
        'u.managedByAgentId',
        'u.createdAt',
      ]);

    if (q.role) qb.andWhere('u.role = :role', { role: q.role });
    if (q.active !== undefined) qb.andWhere('u.isActive = :active', { active: q.active });
    if (q.q) {
      qb.andWhere('LOWER(u.email) LIKE :needle', { needle: `%${q.q.toLowerCase()}%` });
    }

    qb.orderBy('u.createdAt', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(data as unknown as Record<string, unknown>[], total, q.page, q.limit);
  }

  /**
   * One account and everything hanging off it.
   *
   * The screen this feeds exists because the alternative — an administrator
   * opening six lists and filtering each by a uuid — is how the wrong account
   * gets suspended. Password and MFA columns are never selected: there is
   * nothing an administrator can do with a hash except leak it.
   */
  async accountDetail(userId: string) {
    const user = await this.users.findOne({
      where: { id: userId },
      select: [
        'id',
        'email',
        'role',
        'isActive',
        'isVerified',
        'managedByAgentId',
        'phone',
        'createdAt',
      ],
    });
    if (!user) throw new NotFoundException('Account not found');

    const [profiles, listings, placed, raised, against, verifications] = await Promise.all([
      this.profiles.find({ where: [{ userId }, { managedByUserId: userId }] }),
      this.vendors.find({ where: { ownerUserId: userId } }),
      this.bookings.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 20 }),
      this.cases.find({ where: { raisedByUserId: userId }, order: { createdAt: 'DESC' }, take: 20 }),
      this.cases.find({
        where: { assignedToUserId: userId },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
      this.verifications.find({ where: { applicantUserId: userId } }),
    ]);

    return {
      user,
      profiles: profiles.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        lifecycle: p.lifecycle,
        city: p.city,
      })),
      businesses: listings.map((v) => ({
        id: v.id,
        name: v.name,
        category: v.category,
        status: v.status,
        isApproved: v.isApproved,
      })),
      bookings: placed,
      casesRaised: raised,
      casesAssigned: against,
      verifications,
    };
  }

  /**
   * Every business on the platform, by state.
   *
   * A vendor's *account* and their *businesses* are different rows, and this
   * lists the businesses — which is what a question like "how many listings are
   * stuck in first review" is actually about.
   */
  async businesses(q: DirectoryQueryDto): Promise<PaginatedResult<Vendor>> {
    const qb = this.vendors.createQueryBuilder('v');
    if (q.status) qb.andWhere('v.status = :status', { status: q.status });
    if (q.q) qb.andWhere('LOWER(v.name) LIKE :needle', { needle: `%${q.q.toLowerCase()}%` });
    if (q.city) qb.andWhere('LOWER(v.city) = LOWER(:city)', { city: q.city });

    qb.orderBy('v.createdAt', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, q.page, q.limit);
  }

  /**
   * Every booking on the platform, across all thirteen stages.
   *
   * The vendor sees their incoming work and the buyer sees their own; nobody
   * could see the whole book. That is the view a dispute starts from — "what
   * else has this vendor got in flight" — and it is also the only way to notice
   * that forty bookings have been sitting in `payment_pending` for a fortnight.
   */
  async allBookings(q: AdminBookingQueryDto): Promise<PaginatedResult<Booking>> {
    const qb = this.bookings.createQueryBuilder('b');
    if (q.status) qb.andWhere('b.status = :status', { status: q.status });
    if (q.providerId) qb.andWhere('b.providerId = :providerId', { providerId: q.providerId });
    if (q.userId) qb.andWhere('b.userId = :userId', { userId: q.userId });
    if (q.from) qb.andWhere('b.createdAt >= :from', { from: new Date(q.from) });
    if (q.to) qb.andWhere('b.createdAt <= :to', { to: new Date(q.to) });

    qb.orderBy('b.createdAt', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, q.page, q.limit);
  }

  /**
   * The six reports, over a window.
   *
   * One route rather than six, because they differ only in which counts they
   * ask for and every one of them wants the same date window applied the same
   * way. Six near-identical endpoints is six places for the window handling to
   * drift, and it already has a history of doing that.
   *
   * Dates are inclusive at both ends and default to the last thirty days. A
   * report with no window silently means "everything ever", which reads as a
   * catastrophic month the first time somebody screenshots it.
   */
  async report(q: ReportQueryDto) {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from
      ? new Date(q.from)
      : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    // Inclusive of the closing day rather than of midnight on it, which is the
    // difference between "this month" and "this month minus its last day".
    to.setHours(23, 59, 59, 999);
    const window = Between(from, to);

    switch (q.kind) {
      case 'users': {
        const rows = await this.users.find({ where: { createdAt: window }, select: ['role'] });
        const byRole: Record<string, number> = {};
        for (const role of Object.values(UserRole)) byRole[role] = 0;
        for (const r of rows) byRole[r.role] += 1;
        return { kind: q.kind, from, to, total: rows.length, byRole };
      }

      case 'agents': {
        const [agents, onboarded, charges] = await Promise.all([
          this.users.count({ where: { role: UserRole.AGENT, createdAt: window } }),
          this.users.count({ where: { managedByAgentId: Not(IsNull()), createdAt: window } }),
          this.charges.find({ where: { createdAt: window } }),
        ]);
        const money = (status: PaymentStatus) =>
          charges
            .filter((c) => c.status === status)
            .reduce((t, c) => t + Number(c.amount), 0)
            .toFixed(2);
        return {
          kind: q.kind,
          from,
          to,
          agentsRegistered: agents,
          clientsOnboarded: onboarded,
          fees: {
            outstanding: money(PaymentStatus.INITIATED),
            held: money(PaymentStatus.HELD_IN_ESCROW),
            released: money(PaymentStatus.RELEASED),
          },
        };
      }

      case 'vendors': {
        const rows = await this.vendors.find({ where: { createdAt: window } });
        const byStatus: Record<string, number> = {};
        for (const status of Object.values(BusinessStatus)) byStatus[status] = 0;
        for (const v of rows) byStatus[v.status] += 1;
        return {
          kind: q.kind,
          from,
          to,
          listed: rows.length,
          live: rows.filter((v) => v.isApproved).length,
          byStatus,
        };
      }

      case 'bookings': {
        const rows = await this.bookings.find({ where: { createdAt: window } });
        const byStatus: Record<string, number> = {};
        for (const status of Object.values(BookingStatus)) byStatus[status] = 0;
        for (const b of rows) byStatus[b.status] += 1;
        const value = rows.reduce((t, b) => t + Number(b.amount), 0);
        return {
          kind: q.kind,
          from,
          to,
          placed: rows.length,
          byStatus,
          grossValue: value.toFixed(2),
          // Requests that were never priced drag the average to nonsense, so
          // it is taken over the ones that reached a price.
          averageValue: (() => {
            const priced = rows.filter((b) => Number(b.amount) > 0);
            return priced.length ? (value / priced.length).toFixed(2) : '0.00';
          })(),
        };
      }

      case 'financial': {
        const rows = await this.payments.find({ where: { createdAt: window } });
        const sum = (status: PaymentStatus, column: 'amount' | 'payoutAmount' | 'commissionAmount') =>
          rows
            .filter((p) => p.status === status)
            .reduce((t, p) => t + Number(p[column] ?? 0), 0)
            .toFixed(2);
        return {
          kind: q.kind,
          from,
          to,
          collected: rows.reduce((t, p) => t + Number(p.amount), 0).toFixed(2),
          held: sum(PaymentStatus.HELD_IN_ESCROW, 'amount'),
          disputed: sum(PaymentStatus.DISPUTED, 'amount'),
          releasedToProviders: sum(PaymentStatus.RELEASED, 'payoutAmount'),
          commission: sum(PaymentStatus.RELEASED, 'commissionAmount'),
          refunded: sum(PaymentStatus.REFUNDED, 'amount'),
          // Owed and not yet moved. Reported separately because it is neither
          // the platform's money nor the provider's yet, and folding it into
          // either makes one of the two wrong.
          awaitingPayout: sum(PaymentStatus.PENDING_PAYOUT, 'payoutAmount'),
        };
      }

      /*
       * M2 asks for the agent profile-sharing limit to be "reviewed so users
       * get enough relevant profiles". The number itself is a product decision
       * and not one to invent from here — but it is currently being made with
       * no evidence at all, which is the part that can be fixed.
       *
       * So this reports what the limit is actually doing: how much of the
       * network is reachable, how many stewards are up against their quota,
       * and — the figure that decides it — how many active profiles are being
       * shown fewer suggestions than are worth opening the app for.
       */
      case 'matchmaking': {
        const [active, pooled, agents, familyStewards] = await Promise.all([
          this.profiles.count({ where: { lifecycle: ProfileLifecycle.ACTIVE } }),
          this.profiles.count({
            where: {
              lifecycle: ProfileLifecycle.ACTIVE,
              networkVisibility: NetworkVisibility.POOL,
            },
          }),
          this.users.count({ where: { role: UserRole.AGENT } }),
          this.users.count({ where: { role: UserRole.FAMILY } }),
        ]);

        // How full each steward's book is. The quota only bites for the ones
        // at it, and an average hides that: ten agencies at two profiles and
        // one at its ceiling is a very different picture from all eleven at
        // half.
        const managed = await this.profiles
          .createQueryBuilder('p')
          .select('p."managedByUserId"', 'steward')
          .addSelect('COUNT(p.id)', 'held')
          .where('p."managedByUserId" IS NOT NULL')
          .groupBy('p."managedByUserId"')
          .getRawMany<{ steward: string; held: string }>();

        const held = managed.map((r) => Number(r.held)).sort((a, b) => b - a);
        const ceiling = this.cfg.stewardship.maxManagedProfiles;

        return {
          kind: q.kind,
          from,
          to,
          profiles: {
            active,
            // What another agency can actually reach. A pool nobody has opted
            // into is a limit that no quota change would loosen.
            pooled,
            private: active - pooled,
            reachableShare: active ? Number(((pooled / active) * 100).toFixed(1)) : 0,
          },
          stewards: {
            agencies: agents,
            familyMembers: familyStewards,
            withProfiles: held.length,
            ceiling,
            atCeiling: held.filter((n) => n >= ceiling).length,
            busiest: held[0] ?? 0,
            median: held.length ? held[Math.floor(held.length / 2)] : 0,
          },
        };
      }

      case 'verification':
      default: {
        const [requests, cases] = await Promise.all([
          this.verifications.find({ where: { createdAt: window } }),
          this.cases.find({ where: { createdAt: window } }),
        ]);
        const byStatus: Record<string, number> = {};
        for (const status of Object.values(VerificationStatus)) byStatus[status] = 0;
        for (const r of requests) byStatus[r.status] += 1;

        const caseByStatus: Record<string, number> = {};
        for (const status of Object.values(CaseStatus)) caseByStatus[status] = 0;
        for (const c of cases) caseByStatus[c.status] += 1;

        // How long the desk actually takes, over the cases it finished in the
        // window. Measured to resolution rather than to closure, because
        // closure waits on the complainant and would report their silence as
        // the platform being slow.
        const decided = cases.filter((c) => c.resolvedAt);
        const hours = decided.map(
          (c) => (c.resolvedAt!.getTime() - c.createdAt.getTime()) / 3_600_000,
        );
        return {
          kind: 'verification',
          from,
          to,
          requests: requests.length,
          byStatus,
          cases: cases.length,
          caseByStatus,
          medianHoursToResolution: hours.length
            ? Number(hours.sort((a, b) => a - b)[Math.floor(hours.length / 2)].toFixed(1))
            : null,
          stillOpen: cases.filter(
            (c) => c.status !== CaseStatus.CLOSED && c.status !== CaseStatus.RESOLVED,
          ).length,
        };
      }
    }
  }

  /**
   * The two staff directories, kept apart.
   *
   * An administrator and a field officer are not variants of one thing. One
   * decides who gets access; the other goes to an address and writes down what
   * they saw. Listing them together is how somebody gets given the wrong one —
   * and the officer rows carry a workload the admin rows have no meaning for.
   */
  async staff(kind: 'admin' | 'in_person') {
    const role = kind === 'admin' ? UserRole.ADMIN : UserRole.IN_PERSON;
    const rows = await this.users.find({
      where: { role },
      select: ['id', 'email', 'isActive', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
    if (kind === 'admin') {
      return rows.map((u) => ({ ...u, role, openCases: 0, openVisits: 0 }));
    }

    const ids = rows.map((u) => u.id);
    const [openCases, openVisits] = await Promise.all([
      ids.length
        ? this.cases.find({
            where: {
              assignedToUserId: In(ids),
              status: In([
                CaseStatus.ALLOCATED,
                CaseStatus.IN_PROGRESS,
                CaseStatus.WAITING_FOR_INFORMATION,
                CaseStatus.ESCALATED,
                CaseStatus.REASSIGNED,
              ]),
            },
          })
        : ([] as SupportCase[]),
      ids.length
        ? this.verifications.find({
            where: {
              assignedToUserId: In(ids),
              status: In([VerificationStatus.ASSIGNED, VerificationStatus.IN_PROGRESS]),
            },
          })
        : ([] as VerificationRequest[]),
    ]);

    return rows.map((u) => ({
      ...u,
      role,
      // Deliberately two numbers rather than one total: a queue of six visits
      // and a queue of six disputes are different amounts of work, and an
      // allocator choosing on the sum picks the wrong officer.
      openCases: openCases.filter((c) => c.assignedToUserId === u.id).length,
      openVisits: openVisits.filter((v) => v.assignedToUserId === u.id).length,
    }));
  }
}
