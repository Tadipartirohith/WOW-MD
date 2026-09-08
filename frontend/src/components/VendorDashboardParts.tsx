import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Receipt } from '@phosphor-icons/react';
import { BOOKING_STATUS_LABEL } from '../lib/permissions';
import { formatShortDate } from '../lib/dates';
import { EmptyState, Loading } from './ui/Feedback';

/** The presentational pieces of the vendor dashboard (EZ1-I147), split out to
 *  keep the screen itself under the file-size limit. Nothing here fetches. */

export interface IncomingBooking {
  id: string;
  status: string;
  amount: string;
  currency: string;
  eventDate: string | null;
  createdAt: string;
  clientName: string | null;
  eventName: string | null;
  eventVenue: string | null;
  eventCity: string | null;
  serviceName: string | null;
}

export const rupees = (v: string | number) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

/** The server's business-status enum, humanised. */
export const BUSINESS_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  ready_for_review: 'Ready for review',
  first_review: 'In review',
  pending_verification: 'Awaiting verification',
  verification_in_progress: 'Verification in progress',
  verified: 'Verified',
  live: 'Live in search',
  reverification_required: 'Re-verification required',
  rejected: 'Rejected',
};

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function StatCard({
  label,
  value,
  to,
  tone,
  hint,
  icon: Glyph,
}: {
  label: string;
  value: ReactNode;
  to: string;
  tone?: string;
  hint?: string;
  icon?: typeof Receipt;
}) {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-gray-200 bg-surface p-4 transition-[border-color,box-shadow] duration-200 hover:border-gray-300 hover:shadow-card"
    >
      <div className="flex items-center gap-1.5">
        {Glyph && <Glyph size={14} className="text-gray-400" aria-hidden />}
        <p className="truncate text-[0.8125rem] text-gray-500">{label}</p>
      </div>
      <p className={`mt-1.5 font-mono text-[1.75rem] font-medium leading-none tracking-[-0.02em] ${tone ?? 'text-gray-900'}`}>
        {value}
      </p>
      {hint && <p className="mt-1.5 text-xs text-gray-400">{hint}</p>}
    </Link>
  );
}

export function QuickAction({
  to,
  icon: Glyph,
  label,
  hint,
}: {
  to: string;
  icon: typeof Receipt;
  label: string;
  hint?: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-lg border border-gray-200 bg-surface px-4 py-3 transition-colors hover:bg-gray-100"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand-strong">
        <Glyph size={17} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-900">{label}</span>
        {hint && <span className="block truncate text-xs text-gray-400">{hint}</span>}
      </span>
      <ArrowRight
        size={16}
        className="shrink-0 text-gray-300 transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-brand-strong"
        aria-hidden
      />
    </Link>
  );
}

export function BookingList({
  title,
  icon: Glyph,
  bookings,
  loading,
  empty,
}: {
  title: string;
  icon: typeof Receipt;
  bookings: IncomingBooking[];
  loading: boolean;
  empty: string;
}) {
  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Glyph size={18} className="text-gray-400" aria-hidden />
          <h2 className="section-title">{title}</h2>
        </div>
        <Link className="text-sm text-brand-strong hover:underline" to="/bookings">
          View all
        </Link>
      </div>
      {loading ? (
        <Loading rows={3} />
      ) : bookings.length === 0 ? (
        <EmptyState icon={Glyph} title={empty} />
      ) : (
        <ul className="divide-y divide-gray-200">
          {bookings.slice(0, 5).map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">
                  {b.clientName ?? 'Customer'}
                  {b.serviceName && <span className="font-normal text-gray-500"> · {b.serviceName}</span>}
                </p>
                <p className="truncate text-xs text-gray-500">
                  {BOOKING_STATUS_LABEL[b.status] ?? b.status}
                  {Number(b.amount) > 0 ? ` · ${rupees(b.amount)}` : ''}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-gray-600">
                {formatShortDate(b.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
