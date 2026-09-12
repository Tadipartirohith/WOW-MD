import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Not, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { Profile } from '../users/entities/profile.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { AgentCharge } from '../agents/entities/agent-charge.entity';
import { MONEY_TAKEN, ReportsService } from './reports.service';
import { ReportQueryDto } from './dto/console.dto';
import {
  BookingStatus,
  BusinessStatus,
  INDIVIDUAL_ROLES,
  NetworkVisibility,
  PaymentStatus,
  ProfileLifecycle,
  UserRole,
} from '../../common/enums';
import { AppConfigService } from '../../config/app-config.service';

/**
 * The admin report kinds and the daily growth series. The Reports dashboard's
 * own kinds are computed in ReportsService and returned through here.
 *
 * Split out of AdminConsoleService, which had grown past 1,600 lines; the
 * methods moved unchanged.
 */
@Injectable()
export class AdminReportsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(AgentCharge) private readonly charges: Repository<AgentCharge>,
    private readonly cfg: AppConfigService,
    private readonly reportsService: ReportsService,
  ) {}

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
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
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
        /*
         * `total` is every account created, and the Reports page used it as
         * "New Users" -- so the headline counted vendors, agents, planners and
         * officers as though they were people getting married. The admin
         * dashboard fixed the same mistake in EZ1-I224; this is the Reports
         * half of it (EZ1-I242). `total` stays for anything that genuinely
         * wants all accounts.
         */
        const individuals = rows.filter((r) => INDIVIDUAL_ROLES.includes(r.role)).length;
        // Platform roles, all-time and counted the way the dashboard counts them.
        const [vendorCount, plannerCount, officers, agents] = await Promise.all([
          this.vendors.count(),
          this.planners.count(),
          this.users.count({ where: { role: UserRole.IN_PERSON, isActive: true } }),
          this.users.count({ where: { role: UserRole.AGENT } }),
        ]);
        return {
          kind: q.kind,
          from,
          to,
          total: rows.length,
          individuals,
          byRole,
          platform: { vendors: vendorCount, planners: plannerCount, officers, agents },
        };
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
        // A cancelled booking's price was never going to be paid, and counting
        // it inflated "booking value" by every job that fell through (EZ1-I242).
        const live = rows.filter((b) => b.status !== BookingStatus.CANCELLED);
        const value = live.reduce((t, b) => t + Number(b.amount), 0);
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
            const priced = live.filter((b) => Number(b.amount) > 0);
            return priced.length ? (value / priced.length).toFixed(2) : '0.00';
          })(),
        };
      }

      case 'financial': {
        const rows = await this.payments.find({ where: { createdAt: window } });
        const sum = (
          status: PaymentStatus,
          column: 'amount' | 'payoutAmount' | 'commissionAmount',
        ) =>
          rows
            .filter((p) => p.status === status)
            .reduce((t, p) => t + Number(p[column] ?? 0), 0)
            .toFixed(2);
        return {
          kind: q.kind,
          from,
          to,
          // Money actually taken. Every row used to count here, including a
          // payment still at `initiated` and one that failed (EZ1-I242).
          collected: rows
            .filter((p) => MONEY_TAKEN.includes(p.status))
            .reduce((t, p) => t + Number(p.amount), 0)
            .toFixed(2),
          held: sum(PaymentStatus.HELD_IN_ESCROW, 'amount'),
          disputed: sum(PaymentStatus.DISPUTED, 'amount'),
          releasedToProviders: sum(PaymentStatus.RELEASED, 'payoutAmount'),
          commission: sum(PaymentStatus.RELEASED, 'commissionAmount'),
          refunded: sum(PaymentStatus.REFUNDED, 'amount'),
          // Money a case split between the two sides. Without its own line it
          // sat inside Collected and nowhere else on the page (EZ1-I242).
          partiallySettled: sum(PaymentStatus.PARTIALLY_SETTLED, 'amount'),
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

      // The Reports dashboard's kinds, which live in their own service (EZ1-I242).
      case 'payments':
        return { kind: q.kind, from, to, ...(await this.reportsService.payments(from, to)) };
      case 'providers':
        return { kind: q.kind, from, to, ...(await this.reportsService.providers(from, to)) };
      case 'categories':
        return { kind: q.kind, from, to, ...(await this.reportsService.categories(from, to)) };
      case 'support':
        return { kind: q.kind, from, to, ...(await this.reportsService.support(from, to)) };
      case 'verification':
      default:
        return {
          kind: 'verification',
          from,
          to,
          ...(await this.reportsService.verification(from, to)),
        };
    }
  }

  /**
   * New users and new bookings per calendar day over the window (EZ1-I198).
   *
   * `report()` answers "how many in total"; a growth line needs the shape of
   * that total over time, which no existing route gives. Bucketed in memory by
   * UTC day rather than with a dialect-specific `date_trunc` — the same choice
   * `activity()` makes — because the window is at most a month, so it is two
   * indexed reads on `createdAt` and a group of a few dozen rows.
   *
   * Every day in the window gets a bucket, so a quiet day is a zero on the line
   * rather than a gap the eye misreads as missing data.
   */
  async growthSeries(q: { from?: string; to?: string }) {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    to.setHours(23, 59, 59, 999);
    const window = Between(from, to);

    const [users, bookings, payments] = await Promise.all([
      this.users.find({ where: { createdAt: window }, select: ['createdAt', 'role'] }),
      this.bookings.find({
        where: { createdAt: window },
        select: ['createdAt', 'amount', 'status'],
      }),
      // Revenue by the day the money was taken (EZ1-I242).
      this.payments.find({
        where: { createdAt: window, status: In([...MONEY_TAKEN]) },
        select: ['createdAt', 'amount', 'status', 'commissionAmount'],
      }),
    ]);

    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const points = new Map<
      string,
      {
        date: string;
        users: number;
        individuals: number;
        bookings: number;
        value: number;
        collected: number;
        commission: number;
      }
    >();
    // Iterate in UTC so the generated keys align exactly with the UTC keys the
    // row timestamps produce; mixing local and UTC days drops a bucket at the edge.
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
    while (cursor <= end) {
      const key = dayKey(cursor);
      points.set(key, {
        date: key,
        users: 0,
        individuals: 0,
        bookings: 0,
        value: 0,
        collected: 0,
        commission: 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    for (const u of users) {
      const bucket = points.get(dayKey(u.createdAt));
      if (!bucket) continue;
      bucket.users += 1;
      if (INDIVIDUAL_ROLES.includes(u.role)) bucket.individuals += 1;
    }
    for (const b of bookings) {
      const bucket = points.get(dayKey(b.createdAt));
      if (!bucket) continue;
      bucket.bookings += 1;
      if (b.status !== BookingStatus.CANCELLED) bucket.value += Number(b.amount);
    }
    for (const p of payments) {
      const bucket = points.get(dayKey(p.createdAt));
      if (!bucket) continue;
      bucket.collected += Number(p.amount);
      // Commission is earned when the money is released, matching the
      // financial report and the dashboard's escrow position.
      if (p.status === PaymentStatus.RELEASED) bucket.commission += Number(p.commissionAmount ?? 0);
    }

    return { from, to, points: [...points.values()] };
  }
}
