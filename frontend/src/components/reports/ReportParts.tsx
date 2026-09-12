import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { IconProps } from '@phosphor-icons/react';
import { ArrowRight, ArrowClockwise, WarningCircle } from '@phosphor-icons/react';

/*
 * The visual parts Admin Reports is built from (EZ1-I242).
 *
 * Every colour is a live theme token -- brand, positive, caution, critical,
 * surface -- so the page holds in dark mode rather than keeping a light pastel
 * that only works on white. The ticket's per-section tints map onto those four
 * families: people and bookings on brand, money on caution, payments and
 * verification on positive, support on critical, which is the soft peach the
 * light theme already defines.
 *
 * Charts are inline SVG and plain divs, as the dashboard's already were: the
 * shapes here are simple, and a charting dependency is a large price for them.
 */

export type Accent = 'brand' | 'positive' | 'caution' | 'critical';

const CHIP: Record<Accent, string> = {
  brand: 'bg-brand-soft text-brand-strong',
  positive: 'bg-positive-bg text-positive-fg',
  caution: 'bg-caution-bg text-caution-fg',
  critical: 'bg-critical-bg text-critical-fg',
};

export const GRADIENT: Record<Accent, string> = {
  brand: 'from-brand-100 to-brand-50',
  positive: 'from-positive-bg to-surface',
  caution: 'from-caution-bg to-surface',
  critical: 'from-critical-bg to-surface',
};

export const BAR: Record<Accent, string> = {
  brand: 'bg-brand',
  positive: 'bg-positive-fg',
  caution: 'bg-caution-fg',
  critical: 'bg-critical-fg',
};

/** What a query is doing, reduced to the three states a figure can be in. */
export type Load = { isPending: boolean; isError: boolean; refetch: () => unknown };

// ---------------------------------------------------------------- KPI tile

export function KpiTile({
  label,
  value,
  hint,
  to,
  icon: Glyph,
  accent,
  load,
}: {
  label: string;
  value: string;
  hint?: string;
  to?: string;
  icon: ComponentType<IconProps>;
  accent: Accent;
  load: Load;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-[--radius-md] ${CHIP[accent]}`}>
          <Glyph size={22} weight="duotone" aria-hidden />
        </span>
        {to && (
          <ArrowRight
            size={16}
            className="mt-1 -translate-x-1 text-gray-400 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
            aria-hidden
          />
        )}
      </div>
      {load.isPending ? (
        <div className="mt-3 h-7 w-24 animate-pulse rounded bg-surface-sunken" />
      ) : load.isError ? (
        // Never a 0. Zero means nothing happened; this means we could not find out.
        <p className="mt-3 text-sm font-medium text-critical-fg">Unavailable</p>
      ) : (
        <p className="mt-3 text-[1.75rem] font-semibold leading-none tracking-[-0.02em] tabular-nums text-gray-900">
          {value}
        </p>
      )}
      <p className="mt-1.5 text-sm font-medium text-gray-600">{label}</p>
      {hint && !load.isError && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </>
  );

  const frame = `card group relative flex h-full flex-col overflow-hidden bg-gradient-to-br ${GRADIENT[accent]} shadow-card`;
  return to ? (
    <Link
      to={to}
      className={`${frame} transition duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lifted focus-visible:-translate-y-0.5`}
    >
      {body}
    </Link>
  ) : (
    <div className={frame}>{body}</div>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  // Two, then four. Every group on the page holds four tiles, so no row is
  // ever left with a stray card at either width.
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

// ---------------------------------------------------------------- panel

/**
 * A section with a heading, and the loading, empty and error states handled
 * once so no section can render a bare zero when its request failed.
 */
export function Panel({
  title,
  subtitle,
  icon: Glyph,
  load,
  empty,
  emptyText,
  errorText,
  action,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  icon?: ComponentType<IconProps>;
  load: Load;
  empty?: boolean;
  emptyText?: string;
  errorText?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card flex flex-col ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="section-title">{title}</h2>
          {subtitle && <p className="section-subtitle">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {Glyph && <Glyph size={20} weight="duotone" className="text-brand-strong" aria-hidden />}
        </div>
      </div>
      {load.isPending ? (
        <div className="space-y-2">
          <div className="h-4 w-full animate-pulse rounded bg-surface-sunken" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-surface-sunken" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-surface-sunken" />
        </div>
      ) : load.isError ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <WarningCircle size={28} weight="duotone" className="text-critical-fg" aria-hidden />
          <p className="text-sm text-gray-600">{errorText ?? `Unable to load ${title.toLowerCase()}.`}</p>
          <button className="btn-outline inline-flex items-center gap-2 text-sm" onClick={() => load.refetch()}>
            <ArrowClockwise size={16} aria-hidden /> Retry
          </button>
        </div>
      ) : empty ? (
        <p className="py-8 text-center text-sm text-gray-500">{emptyText ?? 'Nothing in this period.'}</p>
      ) : (
        children
      )}
    </section>
  );
}

// ---------------------------------------------------------------- bar list

export interface BarRow {
  key: string;
  label: string;
  value: number;
  display?: string;
  to?: string;
}

/** Proportional horizontal bars. A row with a `to` is a link to the filtered page. */
export function BarList({ rows, accent = 'brand' }: { rows: BarRow[]; accent?: Accent }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const inner = (
          <>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="text-gray-700">{r.label}</span>
              <span className="flex items-center gap-1.5 font-semibold tabular-nums text-gray-900">
                {r.display ?? r.value.toLocaleString('en-IN')}
                {r.to && (
                  <ArrowRight size={12} className="text-gray-400 opacity-0 transition group-hover:opacity-100" aria-hidden />
                )}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
              <div
                className={`h-full rounded-full ${BAR[accent]} transition-[width] duration-500`}
                style={{ width: `${(r.value / max) * 100}%` }}
              />
            </div>
          </>
        );
        return (
          <li key={r.key}>
            {r.to ? (
              <Link to={r.to} className="group -mx-2 block rounded-[--radius-md] px-2 py-1.5 transition hover:bg-surface-sunken">
                {inner}
              </Link>
            ) : (
              <div className="py-1.5">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- trend line

export interface Series {
  key: string;
  label: string;
  /** A text-colour class; the line draws in currentColor. */
  tone: string;
}

/**
 * One or more daily lines over the window, on a shared scale. A single day
 * draws as points, since a line needs two.
 */
export function TrendChart<P extends { date: string }>({
  points,
  series,
  format,
}: {
  points: P[];
  series: Series[];
  format: (n: number) => string;
}) {
  const W = 100;
  const H = 40;
  const values = (key: string) => points.map((p) => Number((p as Record<string, unknown>)[key] ?? 0));
  const max = Math.max(1, ...series.flatMap((s) => values(s.key)));
  const n = points.length;
  const x = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => H - (v / max) * (H - 4) - 2;

  return (
    <div>
      <div className="relative">
        <span className="absolute right-0 top-0 text-[10px] tabular-nums text-gray-400">{format(max)}</span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full" role="img"
          aria-label={series.map((s) => `${s.label}: ${format(values(s.key).reduce((a, b) => a + b, 0))}`).join('; ')}>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} className="text-gray-200" stroke="currentColor"
              strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
          ))}
          {series.map((s, si) => {
            const vs = values(s.key);
            const line = vs.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
            return (
              <g key={s.key} className={s.tone}>
                {si === 0 && n > 1 && (
                  <path d={`M0,${H} ${vs.map((v, i) => `L${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')} L${W},${H} Z`}
                    fill="currentColor" opacity={0.1} />
                )}
                {n > 1 ? (
                  <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round"
                    strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                ) : (
                  <circle cx={x(0)} cy={y(vs[0] ?? 0)} r={1.5} fill="currentColor" />
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex justify-between text-xs text-gray-400">
        <span>{points[0]?.date}</span>
        <span>{points[n - 1]?.date}</span>
      </div>
      {series.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className={`h-2 w-3 rounded-full bg-current ${s.tone}`} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- columns

/** Daily columns, for counts where a line would suggest a continuity that is not there. */
export function ColumnChart({
  points,
  format,
  accent = 'brand',
}: {
  points: { date: string; value: number }[];
  format: (n: number) => string;
  accent?: Accent;
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <div>
      <div className="flex h-40 items-end gap-[2px]" role="img"
        aria-label={`${format(points.reduce((t, p) => t + p.value, 0))} over ${points.length} days`}>
        {points.map((p) => (
          <div key={p.date} className="group relative flex h-full flex-1 items-end">
            <div
              className={`w-full rounded-t-sm ${BAR[accent]} opacity-80 transition group-hover:opacity-100`}
              style={{ height: `${Math.max(p.value > 0 ? 3 : 0, (p.value / max) * 100)}%` }}
            />
            <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-1.5 py-0.5 text-[10px] text-white group-hover:block">
              {p.date}: {format(p.value)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-gray-400">
        <span>{points[0]?.date}</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- composition

export interface Segment {
  label: string;
  value: number;
  bar: string;
  to?: string;
}

/** One proportional bar with a legend carrying the exact figures. */
export function Composition({ segments, format }: { segments: Segment[]; format: (n: number) => string }) {
  const total = segments.reduce((t, s) => t + s.value, 0);
  return (
    <div className="space-y-4">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-sunken" role="img"
        aria-label={`${format(total)} in total`}>
        {segments.filter((s) => s.value > 0).map((s) => (
          <div key={s.label} className={`${s.bar} h-full transition-[width] duration-500`}
            style={{ width: `${(s.value / Math.max(1, total)) * 100}%` }} title={`${s.label}: ${format(s.value)}`} />
        ))}
      </div>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {segments.map((s) => {
          const row = (
            <>
              <span className="flex items-center gap-2 text-gray-600">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.bar}`} aria-hidden />
                {s.label}
              </span>
              <span className="font-semibold tabular-nums text-gray-900">{format(s.value)}</span>
            </>
          );
          return (
            <li key={s.label}>
              {s.to ? (
                <Link to={s.to} className="-mx-2 flex items-center justify-between gap-3 rounded-[--radius-md] px-2 py-1 text-sm transition hover:bg-surface-sunken">
                  {row}
                </Link>
              ) : (
                <div className="flex items-center justify-between gap-3 py-1 text-sm">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- stat and table

export function Stat({ label, value, to }: { label: string; value: string; to?: string }) {
  const inner = (
    <>
      <p className="text-xl font-semibold tabular-nums text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </>
  );
  return to ? (
    <Link to={to} className="block rounded-[--radius-md] bg-surface-sunken px-4 py-3 transition hover:bg-brand-soft">
      {inner}
    </Link>
  ) : (
    <div className="rounded-[--radius-md] bg-surface-sunken px-4 py-3">{inner}</div>
  );
}

export interface Column<R> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  render: (row: R) => ReactNode;
}

export function DataTable<R>({ columns, rows, rowKey }: { columns: Column<R>[]; rows: R[]; rowKey: (r: R) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-gray-500">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`py-2 pr-4 font-medium ${c.align === 'right' ? 'text-right' : ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.key} className={`py-2 pr-4 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
