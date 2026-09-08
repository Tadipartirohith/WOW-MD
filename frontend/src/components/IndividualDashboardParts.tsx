import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { TYPE_LABEL, describe, type Notification } from '../lib/notification-copy';
import { ArrowRight } from '@phosphor-icons/react';

/**
 * The presentational leaves of the individual dashboard, kept out of the data
 * component so neither file runs long. Every card is a link: the whole point of
 * a figure here is the one tap into the module it came from.
 */

export function RecentNotifications({ rows }: { rows: Notification[] }) {
  const qc = useQueryClient();

  async function markRead(id: string) {
    await api.put(`/notifications/${id}/read`, {});
    // Both keys: the feed here and the sidebar badge stay in step.
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['unread-count'] });
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-500">Recent notifications</h2>
        <Link className="text-xs text-brand hover:underline" to="/notifications">
          See all
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="card text-sm text-gray-500">Nothing to catch up on.</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border border-gray-200 bg-surface">
          {rows.map((n) => (
            <li
              key={n.id}
              className={`flex items-start justify-between gap-3 px-4 py-3 ${
                !n.isRead ? 'bg-brand-light/30' : ''
              }`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {TYPE_LABEL[n.type] ?? n.type.replace(/_/g, ' ')}
                </p>
                <p className="truncate text-xs text-gray-500">{describe(n)}</p>
              </div>
              {!n.isRead && (
                <button className="btn-outline btn-sm shrink-0" onClick={() => void markRead(n.id)}>
                  Mark read
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Stat({
  label,
  value,
  to,
  tone,
}: {
  label: string;
  value: ReactNode;
  to: string;
  tone?: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-gray-200 bg-surface p-4 transition-[border-color,box-shadow] duration-200 hover:border-gray-300 hover:shadow-card"
    >
      <p className="truncate text-[0.8125rem] text-gray-500">{label}</p>
      <p
        className={`mt-1.5 font-mono text-[1.75rem] font-medium leading-none tracking-[-0.02em] ${tone ?? 'text-gray-900'}`}
      >
        {value}
      </p>
    </Link>
  );
}

export function Progress({
  label,
  percent,
  to,
  hint,
}: {
  label: string;
  percent: number;
  to: string;
  hint: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <Link
      to={to}
      className="group rounded-lg border border-gray-200 bg-surface p-4 transition-[border-color,box-shadow] duration-200 hover:border-gray-300 hover:shadow-card"
    >
      <div className="flex items-baseline justify-between">
        <p className="text-[0.8125rem] text-gray-500">{label}</p>
        <p className="font-mono text-lg font-medium leading-none text-gray-900">{pct}%</p>
      </div>
      <div className="mt-2 h-1.5 w-full rounded-sm bg-gray-100">
        <div
          className={`h-1.5 rounded-sm ${pct >= 100 ? 'bg-emerald-500' : 'bg-brand'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-gray-500">{hint}</p>
    </Link>
  );
}

export function QuickAction({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-surface px-4 py-2 text-sm font-medium text-gray-800 transition-colors hover:border-gray-300 hover:bg-gray-50"
    >
      {label}
      <ArrowRight size={15} aria-hidden className="text-gray-400" />
    </Link>
  );
}
