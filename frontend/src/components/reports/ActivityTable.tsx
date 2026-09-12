import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { Panel } from './ReportParts';
import type { ReportsData } from './reportData';

/** What each kind of event is called, what it groups under, and its tone. */
const KIND: Record<string, { label: string; group: string; tone: string }> = {
  'account.registered': { label: 'Account', group: 'accounts', tone: 'bg-brand-soft text-brand-strong' },
  'client.onboarded': { label: 'Client', group: 'accounts', tone: 'bg-brand-soft text-brand-strong' },
  'business.created': { label: 'Listing', group: 'accounts', tone: 'bg-caution-bg text-caution-fg' },
  'planner.registered': { label: 'Planner', group: 'accounts', tone: 'bg-caution-bg text-caution-fg' },
  'booking.placed': { label: 'Booking', group: 'bookings', tone: 'bg-positive-bg text-positive-fg' },
  'booking.completed': { label: 'Completed', group: 'bookings', tone: 'bg-positive-bg text-positive-fg' },
  'booking.cancelled': { label: 'Cancelled', group: 'bookings', tone: 'bg-critical-bg text-critical-fg' },
  'payment.received': { label: 'Payment', group: 'payments', tone: 'bg-caution-bg text-caution-fg' },
  'verification.raised': { label: 'Verification', group: 'verification', tone: 'bg-brand-soft text-brand-strong' },
  'verification.approved': { label: 'Approved', group: 'verification', tone: 'bg-positive-bg text-positive-fg' },
  'verification.rejected': { label: 'Rejected', group: 'verification', tone: 'bg-critical-bg text-critical-fg' },
  'case.raised': { label: 'Case', group: 'support', tone: 'bg-critical-bg text-critical-fg' },
  'case.resolved': { label: 'Case resolved', group: 'support', tone: 'bg-positive-bg text-positive-fg' },
  'dispute.raised': { label: 'Dispute', group: 'support', tone: 'bg-critical-bg text-critical-fg' },
};

const GROUPS = [
  { key: 'all', label: 'Everything' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'payments', label: 'Payments' },
  { key: 'verification', label: 'Verification' },
  { key: 'support', label: 'Support' },
  { key: 'accounts', label: 'Accounts' },
];

/** Where an event can be opened. Only resources with a detail page keyed by that id. */
function linkFor(resourceType: string, id: string): string | null {
  if (resourceType === 'booking') return `/admin/bookings/${id}`;
  if (resourceType === 'payment') return `/admin/payments/${id}`;
  return null;
}

/**
 * What happened on the platform in the selected period, newest first (EZ1-I242).
 * Each event is placed by its own moment -- a cancellation by when it was
 * cancelled, not when the booking was made.
 */
export default function ActivityTable({ d, limit }: { d: ReportsData; limit?: number }) {
  const [group, setGroup] = useState('all');
  const rows = (d.activity.data ?? [])
    .filter((a) => group === 'all' || KIND[a.kind]?.group === group)
    .slice(0, limit);

  return (
    <Panel
      title="Recent activity"
      subtitle="Sign-ups, listings, bookings, payments, verification and support, newest first."
      icon={ClockCounterClockwise}
      load={d.activity}
      empty={rows.length === 0}
      emptyText={group === 'all' ? 'No activity in this period.' : 'Nothing of that kind in this period.'}
      action={
        <select className="input py-1 text-sm" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Show activity of kind">
          {GROUPS.map((g) => (
            <option key={g.key} value={g.key}>
              {g.label}
            </option>
          ))}
        </select>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="py-2 pr-4 font-medium">When</th>
              <th className="py-2 pr-4 font-medium">Type</th>
              <th className="py-2 font-medium">What happened</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((a) => {
              const kind = KIND[a.kind];
              const to = linkFor(a.resourceType, a.resourceId);
              return (
                <tr key={`${a.kind}-${a.resourceId}-${a.at}`}>
                  <td className="whitespace-nowrap py-2 pr-4 tabular-nums text-gray-500">
                    {new Date(a.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${kind?.tone ?? 'bg-surface-sunken text-gray-700'}`}>
                      {kind?.label ?? a.kind}
                    </span>
                  </td>
                  <td className="py-2 text-gray-700">
                    {to ? (
                      <Link to={to} className="hover:text-brand-strong hover:underline">
                        {a.summary}
                      </Link>
                    ) : (
                      a.summary
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
