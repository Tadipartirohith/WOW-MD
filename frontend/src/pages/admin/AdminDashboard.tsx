import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { IconProps } from '@phosphor-icons/react';
import {
  UsersThree,
  IdentificationCard,
  Storefront,
  ClipboardText,
  Receipt,
  Hourglass,
  Lifebuoy,
  Scales,
  Vault,
  TrendUp,
} from '@phosphor-icons/react';
import { api } from '../../lib/api';
import { BOOKING_STATUS_LABEL } from '../../lib/permissions';
import { ActivityFeed } from '../../components/AdminConsole';
import Admin360 from '../../components/Admin360';

interface Analytics {
  totalUsers: number;
  totalVendors: number;
  totalPlanners: number;
  totalAgents: number;
  totalBookings: number;
  openDisputes: number;
  usersByRole: { role: string; count: number }[];
  verification: {
    officers: number;
    awaitingAllocation: number;
    inProgress: number;
    approved: number;
    casesOpen: number;
    casesResolved: number;
  };
  matchmaking: {
    profilesActive: number;
    profilesUnclaimed: number;
    profilesArchived: number;
    matchesFixed: number;
    matchesAwaitingConfirmation: number;
  };
  bookingsByStatus: Record<string, number>;
  escrow: {
    bookings: Record<string, string>;
    agencyFees: Record<string, string>;
  };
}

/**
 * The Admin Portal landing screen (EZ1-I153).
 *
 * Every summary card links to the dedicated page that manages what it counts,
 * with the relevant filter already applied where one exists — the escrow card
 * opens Payments filtered to what is held, not the whole ledger. No card is a
 * dead end; that was the rule the tabbed console was built on and it survives
 * the move to routes.
 */
export default function AdminDashboard() {
  const { data: analytics } = useQuery({
    queryKey: ['analytics'],
    queryFn: async () => (await api.get('/admin/analytics')).data as Analytics,
    retry: false,
  });

  /*
   * The nine headline metrics, each a click-through to the page that manages
   * what it counts, with the relevant filter pre-applied where one exists — the
   * escrow card opens Payments filtered to what is held, not the whole ledger.
   *
   * Each card wears a soft gradient (EZ1-I177) drawn from the WOW palette the
   * design system actually holds — rose/pink (brand), peach (the warm caution
   * token) and mint (the positive token) — and an accent that tints its icon to
   * the same family. Everything is a live token, so a card that reads as a warm
   * cream in light mode themes to a lifted rose in dark rather than glowing.
   */
  const cards: SummaryCard[] = analytics
    ? [
        { label: 'Total Users', value: analytics.totalUsers, to: '/admin/users', icon: UsersThree, gradient: 'from-brand-100 to-brand-50', accent: 'brand' },
        { label: 'Total Agents', value: analytics.totalAgents, to: '/admin/agents', icon: IdentificationCard, gradient: 'from-brand-soft to-surface', accent: 'brand' },
        { label: 'Total Vendors', value: analytics.totalVendors, to: '/admin/vendors', icon: Storefront, gradient: 'from-caution-bg to-surface', accent: 'caution' },
        { label: 'Wedding Planners', value: analytics.totalPlanners, to: '/admin/planners', icon: ClipboardText, gradient: 'from-brand-100 to-surface', accent: 'brand' },
        { label: 'Total Bookings', value: analytics.totalBookings, to: '/admin/bookings', icon: Receipt, gradient: 'from-brand-soft to-brand-50', accent: 'brand' },
        { label: 'Awaiting Verification', value: analytics.verification.awaitingAllocation, to: '/verification', icon: Hourglass, gradient: 'from-positive-bg to-surface', accent: 'positive' },
        { label: 'Open Cases', value: analytics.verification.casesOpen, to: '/verification', icon: Lifebuoy, gradient: 'from-caution-bg to-brand-50', accent: 'caution' },
        { label: 'Open Disputes', value: analytics.openDisputes, to: '/verification', icon: Scales, gradient: 'from-brand-50 to-surface', accent: 'brand' },
        {
          label: 'Held in Escrow',
          value: `₹${Number(analytics.escrow?.bookings?.held ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
          to: '/admin/payments?status=held_in_escrow',
          icon: Vault,
          gradient: 'from-positive-bg to-brand-50',
          accent: 'positive',
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Admin</h1>
        <p className="page-subtitle">The platform in aggregate — every tile opens the page that owns it.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {analytics
          ? cards.map((c) => <SummaryTile key={c.label} {...c} />)
          : Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="card h-[104px] animate-pulse bg-surface-sunken" />
            ))}
      </div>

      {analytics?.escrow && <RevenueOverview escrow={analytics.escrow} />}

      {/*
        The lookup comes next: it is the thing an administrator often opens this
        page holding — a support ticket with a uuid in it — while everything
        above and below is the platform in aggregate, a different question.
      */}
      <Admin360 />

      <ActivityFeed />

      {analytics?.matchmaking && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            title="Matchmaking"
            subtitle="What the platform is actually for."
            rows={[
              ['Matches fixed', analytics.matchmaking.matchesFixed],
              ['Awaiting the second confirmation', analytics.matchmaking.matchesAwaitingConfirmation],
              ['Active profiles', analytics.matchmaking.profilesActive],
              ['Profiles with no account yet', analytics.matchmaking.profilesUnclaimed],
              ['Closed', analytics.matchmaking.profilesArchived],
            ]}
          />
          <Panel
            title="Verification"
            subtitle="Work sitting in somebody's queue right now."
            rows={[
              ['Officers on duty', analytics.verification.officers],
              ['Waiting for allocation', analytics.verification.awaitingAllocation],
              ['Visits in progress', analytics.verification.inProgress],
              ['Approved', analytics.verification.approved],
              ['Open cases', analytics.verification.casesOpen],
            ]}
          />
          <Panel
            title="Escrow"
            subtitle="Held is what the platform owes onwards; disputed cannot move."
            rows={[
              ['Held on bookings', `₹${analytics.escrow.bookings.held}`],
              ['Disputed', `₹${analytics.escrow.bookings.disputed}`],
              ['Released to providers', `₹${analytics.escrow.bookings.released}`],
              ['Commission earned', `₹${analytics.escrow.bookings.commission}`],
              ['Agency fees in escrow', `₹${analytics.escrow.agencyFees.held}`],
            ]}
          />
        </div>
      )}

      {analytics?.bookingsByStatus && (
        <div className="card">
          <h2 className="section-title mb-2">Bookings by stage</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(analytics.bookingsByStatus)
              .filter(([, count]) => count > 0)
              .map(([status, count]) => (
                <Link
                  key={status}
                  to={`/admin/bookings?status=${status}`}
                  className="rounded-full bg-brand-soft px-3 py-1 text-sm text-brand-strong transition-colors hover:bg-brand-100"
                >
                  {BOOKING_STATUS_LABEL[status] ?? status}: <strong>{count}</strong>
                </Link>
              ))}
          </div>
        </div>
      )}

      {analytics?.usersByRole && (
        <div className="card">
          <h2 className="section-title mb-2">Accounts by type</h2>
          <div className="flex flex-wrap gap-2">
            {analytics.usersByRole.map((r) => (
              <span key={r.role} className="rounded-full bg-gray-100 px-3 py-1 text-sm">
                {r.role}: <strong>{r.count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type Accent = 'brand' | 'positive' | 'caution';

interface SummaryCard {
  label: string;
  value: number | string;
  to: string;
  icon: ComponentType<IconProps>;
  gradient: string;
  accent: Accent;
}

/** Icon-chip tint per accent family. Every value is a live theme token. */
const ACCENT_CHIP: Record<Accent, string> = {
  brand: 'bg-brand-soft text-brand-strong',
  positive: 'bg-positive-bg text-positive-fg',
  caution: 'bg-caution-bg text-caution-fg',
};

/**
 * One headline metric: an icon chip, a large live count and its label, sitting
 * on a soft gradient. The whole tile is the link — it lifts on hover and the
 * arrow slides in to say so — so a click anywhere lands on the owning page.
 */
function SummaryTile({ label, value, to, icon: Glyph, gradient, accent }: SummaryCard) {
  return (
    <Link
      to={to}
      className={`card group relative overflow-hidden bg-gradient-to-br ${gradient} shadow-card transition duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lifted focus-visible:-translate-y-0.5`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-[--radius-md] ${ACCENT_CHIP[accent]}`}>
          <Glyph size={22} weight="duotone" aria-hidden />
        </span>
        <TrendUp
          size={16}
          className="mt-1 -translate-x-1 text-gray-400 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
          aria-hidden
        />
      </div>
      <p className="mt-3 text-[1.75rem] font-semibold leading-none tracking-[-0.02em] tabular-nums text-gray-900">
        {value}
      </p>
      <p className="mt-1.5 text-sm font-medium text-gray-600">{label}</p>
    </Link>
  );
}

/**
 * Revenue Overview (EZ1-I183).
 *
 * The analytics API reports the escrow position, not a time series, so this is
 * an honest composition of where the platform's money actually sits — released
 * to providers, the platform's commission, still held, disputed, refunded —
 * rather than a fabricated monthly trend. A single proportional bar, drawn from
 * token-coloured divs (no charting dependency), with a legend carrying the
 * exact rupee figures beneath it.
 */
function RevenueOverview({ escrow }: { escrow: Analytics['escrow'] }) {
  const num = (v?: string) => Number(v ?? 0);
  const b = escrow.bookings;
  const commission = num(b.commission) + num(escrow.agencyFees?.commission);

  const segments: { label: string; value: number; bar: string; dot: string }[] = [
    { label: 'Released to providers', value: num(b.released), bar: 'bg-positive-fg', dot: 'bg-positive-fg' },
    { label: 'Platform commission', value: commission, bar: 'bg-brand', dot: 'bg-brand' },
    { label: 'Held in escrow', value: num(b.held), bar: 'bg-caution-fg', dot: 'bg-caution-fg' },
    { label: 'Disputed', value: num(b.disputed), bar: 'bg-critical-fg', dot: 'bg-critical-fg' },
    { label: 'Refunded', value: num(b.refunded), bar: 'bg-gray-400', dot: 'bg-gray-400' },
  ];
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const inr = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

  const stats: { label: string; value: number }[] = [
    { label: 'Funds processed', value: total },
    { label: 'Commission earned', value: commission },
    { label: 'Currently in escrow', value: num(b.held) },
  ];

  return (
    <section className="card space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="section-title">Revenue Overview</h2>
          <p className="section-subtitle">Where every rupee that has moved through the platform sits today.</p>
        </div>
        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-[--radius-md] bg-brand-soft text-brand-strong sm:inline-flex">
          <TrendUp size={22} weight="duotone" aria-hidden />
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-[--radius-md] bg-surface-sunken px-4 py-3">
            <p className="text-xl font-semibold tabular-nums text-gray-900">{inr(s.value)}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {total === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">No payments have moved through escrow yet.</p>
      ) : (
        <div className="space-y-4">
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-surface-sunken"
            role="img"
            aria-label={`Escrow composition, ${inr(total)} total`}
          >
            {segments
              .filter((s) => s.value > 0)
              .map((s) => (
                <div
                  key={s.label}
                  className={`${s.bar} h-full transition-[width] duration-500`}
                  style={{ width: `${(s.value / total) * 100}%` }}
                  title={`${s.label}: ${inr(s.value)}`}
                />
              ))}
          </div>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {segments.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-gray-600">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`} aria-hidden />
                  {s.label}
                </span>
                <span className="font-semibold tabular-nums text-gray-900">{inr(s.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Panel({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: [string, string | number][];
}) {
  return (
    <div className="card">
      <h2 className="section-title">{title}</h2>
      <p className="mb-2 text-xs text-gray-500">{subtitle}</p>
      <div className="divide-y">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between py-1.5 text-sm">
            <span className="text-gray-600">{label}</span>
            <span className="font-semibold tabular-nums text-gray-900">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
