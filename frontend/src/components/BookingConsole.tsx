import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarBlank, MapPin, UsersThree } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { formatDate } from '../lib/dates';
import { EmptyState, Loading } from './ui/Feedback';

/**
 * The work coming in, as one screen instead of four.
 *
 * The provider list used to be sections of rows carrying an amount, a status
 * and a date. Everything that decides whether to take a job — who it is for,
 * where, how many people, which service, whether any money has moved — was on
 * other screens, so a planner answered requests either blind or slowly.
 *
 * The tabs count everything rather than the page, filtering is client-side
 * because a provider's whole queue is tens of rows and a round trip per
 * keystroke would be slower and worse, and the lifecycle is drawn once at the
 * top rather than explained per row.
 */

interface IncomingBooking {
  id: string;
  status: string;
  amount: string;
  currency: string;
  eventDate: string | null;
  createdAt: string;
  requirements: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  eventName: string | null;
  eventVenue: string | null;
  eventCity: string | null;
  expectedGuests: number | null;
  serviceName: string | null;
  paymentStatus: string | null;
}

/** The tabs, and which statuses each gathers. */
const TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'all', label: 'All', statuses: [] },
  { key: 'requests', label: 'Requests', statuses: ['requested', 'quotation_sent', 'quotation_accepted'] },
  { key: 'confirmed', label: 'Confirmed', statuses: ['payment_pending', 'pending', 'confirmed'] },
  { key: 'in_progress', label: 'In progress', statuses: ['in_progress'] },
  { key: 'completed', label: 'Completed', statuses: ['completed', 'completed_pending_final_payment'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled', 'disputed'] },
];

const PAYMENT_LABEL: Record<string, string> = {
  initiated: 'Payment started',
  held_in_escrow: 'Held in escrow',
  disputed: 'Disputed',
  pending_payout: 'Owed to you',
  released: 'Paid out',
  refunded: 'Refunded',
};

const PAYMENT_TONE: Record<string, string> = {
  initiated: 'bg-surface-sunken text-gray-600',
  held_in_escrow: 'bg-brand-soft text-brand-strong',
  disputed: 'bg-critical-bg text-critical-fg',
  pending_payout: 'bg-caution-bg text-caution-fg',
  released: 'bg-positive-bg text-positive-fg',
  refunded: 'bg-critical-bg text-critical-fg',
};

/** Where a job goes, said once rather than implied by six section headings. */
const LIFECYCLE = [
  'Request',
  'Quotation',
  'Accepted',
  'Paid',
  'Confirmed',
  'In progress',
  'Completed',
];

export default function BookingConsole({
  statusLabels,
  renderDetail,
  renderActions,
}: {
  statusLabels: Record<string, string>;
  /** Extra detail under the facts — the answers a client gave, for instance. */
  renderDetail?: (booking: IncomingBooking) => React.ReactNode;
  /** The buttons for a row. Owned by the caller because what a provider may do
   *  depends on rules that live with the booking, not with this list. */
  renderActions?: (booking: IncomingBooking) => React.ReactNode;
}) {
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'event'>('newest');

  const { data, isPending } = useQuery({
    queryKey: ['incoming-bookings'],
    queryFn: async () => (await api.get('/bookings/incoming', { params: { limit: 100 } })).data,
    retry: false,
  });

  const { data: counts } = useQuery({
    queryKey: ['incoming-counts'],
    queryFn: async () => (await api.get('/bookings/incoming/counts')).data as Record<string, number>,
    retry: false,
  });

  const all: IncomingBooking[] = data?.data ?? data?.items ?? [];

  const rows = useMemo(() => {
    const wanted = TABS.find((t) => t.key === tab)?.statuses ?? [];
    const term = search.trim().toLowerCase();

    const filtered = all.filter((b) => {
      if (wanted.length > 0 && !wanted.includes(b.status)) return false;
      if (!term) return true;
      // Everything somebody might type: a couple, a booking reference, a
      // venue, a city, a service.
      return [b.clientName, b.clientEmail, b.eventName, b.eventVenue, b.eventCity, b.serviceName, b.id]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term));
    });

    return [...filtered].sort((a, b) => {
      if (sort === 'event') {
        // Undated jobs last: they are the ones with nothing to plan around.
        if (!a.eventDate) return 1;
        if (!b.eventDate) return -1;
        return a.eventDate.localeCompare(b.eventDate);
      }
      const order = a.createdAt.localeCompare(b.createdAt);
      return sort === 'oldest' ? order : -order;
    });
  }, [all, tab, search, sort]);

  const countFor = (entry: (typeof TABS)[number]): number | undefined => {
    if (!counts) return undefined;
    if (entry.key === 'all') return counts.all;
    return entry.statuses.reduce((n, status) => n + (counts[status] ?? 0), 0);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {TABS.map((entry) => {
          const count = countFor(entry);
          return (
            <button
              key={entry.key}
              onClick={() => setTab(entry.key)}
              className={
                tab === entry.key
                  ? 'rounded-full bg-brand px-3 py-1 text-xs font-medium text-brand-fg'
                  : 'rounded-full bg-surface-sunken px-3 py-1 text-xs text-gray-600 hover:bg-gray-100'
              }
            >
              {entry.label}
              {count !== undefined && (
                <span className="ml-1.5 font-mono opacity-70">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="input flex-1 py-1.5 text-sm sm:max-w-xs"
          placeholder="Couple, venue, service or booking id"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input w-auto py-1.5 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
        >
          <option value="newest">Newest request</option>
          <option value="oldest">Oldest request</option>
          <option value="event">Wedding date</option>
        </select>
      </div>

      {/*
        The lifecycle, once. Six section headings implied it and never said it,
        so a provider seeing "quotation_accepted" had to work out whether
        anything was expected of them next.
      */}
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.6875rem] text-gray-400">
        {LIFECYCLE.map((step, i) => (
          <li key={step} className="flex items-center gap-1.5">
            <span>{step}</span>
            {i < LIFECYCLE.length - 1 && <span aria-hidden>&rarr;</span>}
          </li>
        ))}
      </ol>

      {isPending ? (
        <Loading rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarBlank} title="Nothing here yet">
          {search
            ? 'Nothing matches that search.'
            : 'Requests from couples arrive here. Publishing your availability and your prices is what makes them findable.'}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {rows.map((booking) => (
            <li key={booking.id} className="rounded-lg border border-gray-200 bg-surface p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {/* The real customer/couple name; "Customer" only when the
                        record genuinely has no name (EZ1-I33), never "A client". */}
                    {booking.clientName ?? 'Customer'}
                    {booking.serviceName && (
                      <span className="font-normal text-gray-500"> · {booking.serviceName}</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    Asked {formatDate(booking.createdAt)} · {booking.id.slice(0, 8)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-gray-700">
                    {statusLabels[booking.status] ?? booking.status.replace(/_/g, ' ')}
                  </span>
                  {booking.paymentStatus && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        PAYMENT_TONE[booking.paymentStatus] ?? 'bg-surface-sunken text-gray-600'
                      }`}
                    >
                      {PAYMENT_LABEL[booking.paymentStatus] ?? booking.paymentStatus}
                    </span>
                  )}
                </div>
              </div>

              {/*
                What the decision is actually made on. Every one of these
                existed and none was on the row, so answering a request meant
                opening the wedding, the client and the quotation separately.
              */}
              <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                {booking.eventDate && (
                  <div className="flex items-center gap-1.5">
                    <CalendarBlank size={13} className="text-gray-400" aria-hidden />
                    <dd>{formatDate(booking.eventDate)}</dd>
                  </div>
                )}
                {(booking.eventVenue || booking.eventCity) && (
                  <div className="flex items-center gap-1.5">
                    <MapPin size={13} className="text-gray-400" aria-hidden />
                    <dd>{[booking.eventVenue, booking.eventCity].filter(Boolean).join(', ')}</dd>
                  </div>
                )}
                {booking.expectedGuests ? (
                  <div className="flex items-center gap-1.5">
                    <UsersThree size={13} className="text-gray-400" aria-hidden />
                    <dd>{booking.expectedGuests} guests</dd>
                  </div>
                ) : null}
                <div className="flex items-center gap-1.5">
                  <dt className="text-gray-400">Amount</dt>
                  <dd className="font-mono">
                    {booking.currency} {Number(booking.amount).toLocaleString('en-IN')}
                  </dd>
                </div>
              </dl>

              {renderDetail?.(booking)}

              {booking.requirements && (
                <p className="mt-2 rounded-sm bg-surface-sunken p-2 text-xs text-gray-700">
                  {booking.requirements}
                </p>
              )}

              {renderActions && (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-2">
                  {renderActions(booking)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
