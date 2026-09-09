import { useMemo, useState, type ComponentType } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { IconProps } from '@phosphor-icons/react';
import {
  UsersThree,
  Receipt,
  CurrencyInr,
  ChartLineUp,
  DownloadSimple,
  TrendUp,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import { BOOKING_STATUS_LABEL } from '../lib/permissions';

/*
 * The Admin Reports analytics dashboard (EZ1-I198).
 *
 * Every figure on this page is a live read of a real /admin endpoint over the
 * chosen window — nothing is hardcoded. The three windowed reports (users,
 * bookings, financial) feed the cards, the booking-status chart and the revenue
 * composition; a dedicated timeseries route feeds the growth line, which is the
 * one series the report totals could not give. It reuses the WOW gradient card
 * and proportional-bar patterns the I183 dashboard established, so the two admin
 * screens read as one system.
 */

type RangeKey = 'today' | '7d' | '30d' | 'month';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
  { key: 'month', label: 'This Month' },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** A preset resolved to an inclusive [from, to] pair of YYYY-MM-DD strings. */
function resolveRange(key: RangeKey): { from: string; to: string } {
  const now = new Date();
  const to = iso(now);
  if (key === 'today') return { from: to, to };
  if (key === 'month') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  const back = key === '7d' ? 6 : 29;
  return { from: iso(new Date(now.getTime() - back * 86_400_000)), to };
}

interface UsersReport {
  total: number;
  byRole: Record<string, number>;
}
interface BookingsReport {
  placed: number;
  byStatus: Record<string, number>;
  grossValue: string;
  averageValue: string;
}
interface FinancialReport {
  collected: string;
  held: string;
  disputed: string;
  releasedToProviders: string;
  commission: string;
  refunded: string;
  awaitingPayout: string;
}
interface SeriesPoint {
  date: string;
  users: number;
  bookings: number;
}
interface Series {
  points: SeriesPoint[];
}
interface ActivityRow {
  at: string;
  kind: string;
  summary: string;
  resourceType: string;
  resourceId: string;
}

const inr = (v: string | number) =>
  `₹${Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export default function AdminReportsDashboard() {
  const [range, setRange] = useState<RangeKey>('30d');
  const { from, to } = useMemo(() => resolveRange(range), [range]);

  const report = <T,>(kind: string) =>
    useQuery<T>({
      queryKey: ['admin-report', kind, from, to],
      queryFn: async () =>
        (await api.get('/admin/reports', { params: { kind, from, to } })).data as T,
      retry: false,
    });

  const users = report<UsersReport>('users');
  const bookings = report<BookingsReport>('bookings');
  const financial = report<FinancialReport>('financial');

  const series = useQuery<Series>({
    queryKey: ['admin-report-series', from, to],
    queryFn: async () =>
      (await api.get('/admin/reports/timeseries', { params: { from, to } })).data as Series,
    retry: false,
  });

  const activity = useQuery<ActivityRow[]>({
    queryKey: ['admin-activity', 'reports'],
    queryFn: async () => (await api.get('/admin/activity', { params: { limit: 12 } })).data,
    retry: false,
  });

  const loading = users.isPending || bookings.isPending || financial.isPending;

  const cards: StatCard[] = [
    {
      label: 'New Users',
      value: users.data ? users.data.total.toLocaleString('en-IN') : '—',
      icon: UsersThree,
      gradient: 'from-brand-100 to-brand-50',
      accent: 'brand',
    },
    {
      label: 'New Bookings',
      value: bookings.data ? bookings.data.placed.toLocaleString('en-IN') : '—',
      icon: Receipt,
      gradient: 'from-brand-soft to-surface',
      accent: 'brand',
    },
    {
      label: 'Gross Booking Value',
      value: bookings.data ? inr(bookings.data.grossValue) : '—',
      icon: TrendUp,
      gradient: 'from-caution-bg to-surface',
      accent: 'caution',
    },
    {
      label: 'Revenue Collected',
      value: financial.data ? inr(financial.data.collected) : '—',
      icon: CurrencyInr,
      gradient: 'from-positive-bg to-brand-50',
      accent: 'positive',
    },
  ];

  function download() {
    const rows: (string | number)[][] = [['WOW — Admin report'], ['Window', from, 'to', to], []];
    rows.push(['Summary'], ...cards.map((c) => [c.label, String(c.value)]), []);
    if (bookings.data) {
      rows.push(['Bookings by status']);
      for (const [status, count] of Object.entries(bookings.data.byStatus)) {
        if (count > 0) rows.push([BOOKING_STATUS_LABEL[status] ?? status, count]);
      }
      rows.push([]);
    }
    if (financial.data) {
      rows.push(['Financial (₹)']);
      for (const [k, v] of Object.entries(financial.data)) rows.push([k, v]);
      rows.push([]);
    }
    if (series.data) {
      rows.push(['Daily growth'], ['Date', 'New users', 'New bookings']);
      for (const p of series.data.points) rows.push([p.date, p.users, p.bookings]);
    }
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `wow-report-${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Reports &amp; Analytics</h1>
          <p className="page-subtitle">
            The platform over your chosen window — every figure a live read, nothing invented.
          </p>
        </div>
        <button className="btn inline-flex items-center gap-2" onClick={download} disabled={loading}>
          <DownloadSimple size={18} weight="bold" aria-hidden />
          Download report
        </button>
      </header>

      {/* Date-range filter */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Report window">
        {RANGES.map((r) => (
          <button
            key={r.key}
            role="tab"
            aria-selected={range === r.key}
            onClick={() => setRange(r.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              range === r.key
                ? 'bg-brand text-white shadow-card'
                : 'bg-surface-sunken text-gray-600 hover:bg-brand-soft hover:text-brand-strong'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Gradient statistic cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card h-[104px] animate-pulse bg-surface-sunken" />
            ))
          : cards.map((c) => <StatTile key={c.label} {...c} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GrowthChart points={series.data?.points ?? []} loading={series.isPending} />
        <BookingStatusChart byStatus={bookings.data?.byStatus} loading={bookings.isPending} />
      </div>

      <RevenueOverview financial={financial.data} loading={financial.isPending} />

      <RecentActivity rows={activity.data ?? []} loading={activity.isPending} />
    </div>
  );
}

type Accent = 'brand' | 'positive' | 'caution';

interface StatCard {
  label: string;
  value: number | string;
  icon: ComponentType<IconProps>;
  gradient: string;
  accent: Accent;
}

const ACCENT_CHIP: Record<Accent, string> = {
  brand: 'bg-brand-soft text-brand-strong',
  positive: 'bg-positive-bg text-positive-fg',
  caution: 'bg-caution-bg text-caution-fg',
};

function StatTile({ label, value, icon: Glyph, gradient, accent }: StatCard) {
  return (
    <div className={`card relative overflow-hidden bg-gradient-to-br ${gradient} shadow-card`}>
      <span
        className={`inline-flex h-10 w-10 items-center justify-center rounded-[--radius-md] ${ACCENT_CHIP[accent]}`}
      >
        <Glyph size={22} weight="duotone" aria-hidden />
      </span>
      <p className="mt-3 text-[1.75rem] font-semibold leading-none tracking-[-0.02em] tabular-nums text-gray-900">
        {value}
      </p>
      <p className="mt-1.5 text-sm font-medium text-gray-600">{label}</p>
    </div>
  );
}

/**
 * User growth over the window, as a filled area line drawn from the timeseries
 * endpoint. Inline SVG on a 0..100 viewBox stretched to the card, so it scales
 * with the column and needs no charting dependency. Colour is a live theme
 * token via currentColor, so it lifts in dark rather than staying a flat ink.
 */
function GrowthChart({ points, loading }: { points: SeriesPoint[]; loading: boolean }) {
  const total = points.reduce((n, p) => n + p.users, 0);
  const max = Math.max(1, ...points.map((p) => p.users));
  const W = 100;
  const H = 36;
  const n = points.length;

  const coords = points.map((p, i) => {
    const x = n <= 1 ? W / 2 : (i / (n - 1)) * W;
    const y = H - (p.users / max) * (H - 4) - 2;
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = n
    ? `M0,${H} ${coords.map(([x, y]) => `L${x.toFixed(2)},${y.toFixed(2)}`).join(' ')} L${W},${H} Z`
    : '';

  return (
    <section className="card">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="section-title">User growth</h2>
        <ChartLineUp size={20} weight="duotone" className="text-brand-strong" aria-hidden />
      </div>
      <p className="section-subtitle mb-4">New accounts per day · {total} in window</p>
      {loading ? (
        <div className="h-32 animate-pulse rounded-[--radius-md] bg-surface-sunken" />
      ) : total === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">No new users in this window.</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-32 w-full text-brand"
            role="img"
            aria-label={`${total} new users over ${n} days`}
          >
            {area && <path d={area} fill="currentColor" opacity={0.12} />}
            <path
              d={line}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className="mt-2 flex justify-between text-xs text-gray-400">
            <span>{points[0]?.date}</span>
            <span>{points[points.length - 1]?.date}</span>
          </div>
        </>
      )}
    </section>
  );
}

/** Bookings by stage over the window, as proportional horizontal bars. */
function BookingStatusChart({
  byStatus,
  loading,
}: {
  byStatus?: Record<string, number>;
  loading: boolean;
}) {
  const rows = Object.entries(byStatus ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, c]) => c));

  return (
    <section className="card">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="section-title">Bookings by stage</h2>
        <Receipt size={20} weight="duotone" className="text-brand-strong" aria-hidden />
      </div>
      <p className="section-subtitle mb-4">Where the window&apos;s bookings sit today.</p>
      {loading ? (
        <div className="h-32 animate-pulse rounded-[--radius-md] bg-surface-sunken" />
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">No bookings in this window.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map(([status, count]) => (
            <li key={status}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-gray-600">{BOOKING_STATUS_LABEL[status] ?? status}</span>
                <span className="font-semibold tabular-nums text-gray-900">{count}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-500"
                  style={{ width: `${(count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Revenue over the window as a composition of where the money went — released,
 * commission, held, disputed, refunded, awaiting payout — reusing the I183
 * proportional-bar + legend pattern. `collected` rides above as the headline;
 * the segments are the disjoint parts beneath it.
 */
function RevenueOverview({
  financial,
  loading,
}: {
  financial?: FinancialReport;
  loading: boolean;
}) {
  const num = (v?: string) => Number(v ?? 0);
  const segments = financial
    ? [
        { label: 'Released to providers', value: num(financial.releasedToProviders), bar: 'bg-positive-fg' },
        { label: 'Platform commission', value: num(financial.commission), bar: 'bg-brand' },
        { label: 'Held in escrow', value: num(financial.held), bar: 'bg-caution-fg' },
        { label: 'Disputed', value: num(financial.disputed), bar: 'bg-critical-fg' },
        { label: 'Awaiting payout', value: num(financial.awaitingPayout), bar: 'bg-brand-400' },
        { label: 'Refunded', value: num(financial.refunded), bar: 'bg-gray-400' },
      ]
    : [];
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <section className="card space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="section-title">Revenue overview</h2>
          <p className="section-subtitle">Every rupee that moved in the window, by where it went.</p>
        </div>
        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-[--radius-md] bg-brand-soft text-brand-strong sm:inline-flex">
          <CurrencyInr size={22} weight="duotone" aria-hidden />
        </span>
      </div>

      {loading ? (
        <div className="h-24 animate-pulse rounded-[--radius-md] bg-surface-sunken" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Collected" value={inr(financial?.collected ?? 0)} />
            <Stat label="Commission earned" value={inr(financial?.commission ?? 0)} />
            <Stat label="Currently held" value={inr(financial?.held ?? 0)} />
          </div>
          {total === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400">
              No payments moved through escrow in this window.
            </p>
          ) : (
            <div className="space-y-4">
              <div
                className="flex h-3 w-full overflow-hidden rounded-full bg-surface-sunken"
                role="img"
                aria-label={`Revenue composition, ${inr(total)} total`}
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
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.bar}`} aria-hidden />
                      {s.label}
                    </span>
                    <span className="font-semibold tabular-nums text-gray-900">{inr(s.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[--radius-md] bg-surface-sunken px-4 py-3">
      <p className="text-xl font-semibold tabular-nums text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

const KIND_TONE: Record<string, string> = {
  'account.registered': 'bg-sky-50 text-sky-800',
  'business.created': 'bg-violet-50 text-violet-800',
  'booking.placed': 'bg-emerald-50 text-emerald-800',
  'case.raised': 'bg-red-50 text-red-800',
  'verification.raised': 'bg-amber-50 text-amber-800',
  'client.onboarded': 'bg-gray-100 text-gray-700',
};

/** The latest platform activity as a table — sign-ups, listings, bookings, cases. */
function RecentActivity({ rows, loading }: { rows: ActivityRow[]; loading: boolean }) {
  return (
    <section className="card">
      <h2 className="section-title mb-1">Recent activity</h2>
      <p className="section-subtitle mb-3">The ordinary life of the platform, newest first.</p>
      {loading ? (
        <div className="h-24 animate-pulse rounded-[--radius-md] bg-surface-sunken" />
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">Nothing has happened yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2">What happened</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((a) => (
                <tr key={`${a.resourceType}-${a.resourceId}-${a.at}`}>
                  <td className="whitespace-nowrap py-2 pr-3 text-gray-500">
                    {new Date(a.at).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        KIND_TONE[a.kind] ?? 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {a.kind.split('.')[1] ?? a.kind}
                    </span>
                  </td>
                  <td className="py-2 text-gray-700">{a.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
