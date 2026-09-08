import { useMemo, useState } from 'react';

/**
 * Bookings over time, as a small hand-rolled bar chart (EZ1-I147).
 *
 * No charting library — external libs are restricted here — so the bars are
 * plain divs sized by proportion, which also keeps them theme-aware for free:
 * `bg-brand` is a token that follows light and dark. The buckets are computed
 * from the real incoming-bookings list the dashboard already holds, bucketed by
 * the month each request was placed, so nothing here is a second fetch or a
 * made-up figure.
 */

interface ChartBooking {
  createdAt: string;
}

const PERIODS: { key: number; label: string }[] = [
  { key: 3, label: '3 months' },
  { key: 6, label: '6 months' },
  { key: 12, label: '12 months' },
];

/** The last `months` calendar months, oldest first, as {label,count} buckets. */
function bucketByMonth(bookings: ChartBooking[], months: number) {
  const now = new Date();
  const buckets: { key: string; label: string; count: number }[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${d.getMonth()}`,
      label: d.toLocaleDateString(undefined, { month: 'short' }),
      count: 0,
    });
  }
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  for (const b of bookings) {
    const t = new Date(b.createdAt);
    if (Number.isNaN(t.getTime())) continue;
    const at = index.get(`${t.getFullYear()}-${t.getMonth()}`);
    if (at !== undefined) buckets[at].count += 1;
  }
  return buckets;
}

export default function BookingsOverviewChart({ bookings }: { bookings: ChartBooking[] }) {
  const [months, setMonths] = useState(6);
  const buckets = useMemo(() => bucketByMonth(bookings, months), [bookings, months]);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((n, b) => n + b.count, 0);

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="section-title">Bookings overview</h2>
          <p className="text-sm text-gray-500">
            Requests placed in the last {months} months.
          </p>
        </div>
        <div className="flex gap-1 rounded-md bg-surface-sunken p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setMonths(p.key)}
              className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
                months === p.key
                  ? 'bg-surface-raised text-gray-900 shadow-btn'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {total === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">
          No requests in this period yet.
        </p>
      ) : (
        <div className="flex items-end gap-2" style={{ height: '10rem' }} role="img" aria-label={`${total} bookings over ${months} months`}>
          {buckets.map((b) => (
            <div key={b.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="text-xs font-medium tabular-nums text-gray-500">
                {b.count > 0 ? b.count : ''}
              </span>
              <div className="flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t-sm bg-brand transition-[height] duration-300"
                  style={{ height: `${(b.count / max) * 100}%`, minHeight: b.count > 0 ? '0.25rem' : '0' }}
                  title={`${b.label}: ${b.count}`}
                />
              </div>
              <span className="w-full truncate text-center text-[0.6875rem] text-gray-400">
                {b.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
