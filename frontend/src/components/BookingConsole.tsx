import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  /**
   * The published window this was booked into, when there was one.
   *
   * Null means the customer named a date the provider had not opened — a
   * "request on date" rather than a booking against a slot (EZ1-I227). The
   * distinction is not a status, it is how the request arrived, which is why
   * it is read from here rather than from `status`.
   */
  slotId?: string | null;
  requirements: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  /** The client's own city and photo, for the provider's booking detail (EZ1-I109). */
  clientCity?: string | null;
  clientPhoto?: string | null;
  /** A note the customer added to the request, distinct from requirements. */
  notes?: string | null;
  eventName: string | null;
  eventVenue: string | null;
  eventCity: string | null;
  expectedGuests: number | null;
  serviceName: string | null;
  /** The package the customer picked, if any (EZ1-I33). */
  offeringName?: string | null;
  /** What the customer said they had in mind, before any quote (EZ1-I33, I78). */
  expectedBudget?: string | null;
  paymentStatus: string | null;
  /** Cancellation detail on a cancelled row (EZ1-I68). */
  cancellationReason?: string | null;
  cancelledByName?: string | null;
  cancelledByRole?: string | null;
}

/**
 * The one thing this booking is waiting on the provider to do, by status
 * (EZ1-I68). Empty when the ball is in the customer's court or the job is done.
 */
const NEXT_ACTION: Record<string, string> = {
  requested: 'Send a quotation',
  quotation_accepted: 'Accept the job',
  payment_pending: 'Awaiting the advance',
  confirmed: 'Start the work',
  in_progress: 'Mark delivered when done',
  completed_pending_final_payment: 'Awaiting the final payment',
};

/**
 * Whether this arrived as a request against a date the provider never opened.
 *
 * The customer wanted a day with no published window and asked anyway, which
 * the provider has to answer differently: they are being asked whether they
 * *can* do it at all, not merely for a price against a slot they already
 * offered (EZ1-I227). Still an ordinary booking underneath — accepting it puts
 * it back on the same quotation-to-payment path as everything else — so it is
 * derived here rather than given a status of its own.
 */
function isRequestOnDate(b: IncomingBooking): boolean {
  return (
    !b.slotId &&
    Boolean(b.eventDate) &&
    ['requested', 'quotation_sent', 'quotation_accepted'].includes(b.status)
  );
}

/** The tabs, and which statuses each gathers. */
const TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'all', label: 'All', statuses: [] },
  { key: 'requests', label: 'Requests', statuses: ['requested', 'quotation_sent', 'quotation_accepted'] },
  // Derived rather than status-based; `statuses` stays empty and the filter
  // below special-cases it.
  { key: 'request_on_date', label: 'Request on Date', statuses: [] },
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
  // Delivered is its own step, not a synonym for completed: the vendor has
  // handed the work over and the customer has still to confirm it and pay the
  // balance. Leaving it out is what made "Awaiting the final payment" look like
  // a variety of Completed (EZ1-I259).
  'Delivered',
  'Completed',
];

export default function BookingConsole({
  statusLabels,
  renderDetail,
  renderActions,
}: {
  statusLabels: Record<string, string>;
  /**
   * The whole record, behind a fold.
   *
   * Shown only when the provider asks for it (EZ1-I252). It was rendered
   * unconditionally under every row, which is readable at four bookings and
   * unusable at forty — and it costs three queries a row, so a queue of forty
   * opened a hundred and twenty of them to show detail nobody had asked to
   * see.
   */
  renderDetail?: (booking: IncomingBooking) => React.ReactNode;
  /** The buttons for a row. Owned by the caller because what a provider may do
   *  depends on rules that live with the booking, not with this list. */
  renderActions?: (booking: IncomingBooking) => React.ReactNode;
}) {
  // A dashboard card can deep-link a tab (e.g. /bookings?tab=requests). Unknown
  // or absent falls back to "all", so existing links keep working (EZ1-I147).
  const [params] = useSearchParams();
  const wantedTab = params.get('tab');
  const [tab, setTab] = useState(
    TABS.some((t) => t.key === wantedTab) ? (wantedTab as string) : 'all',
  );
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'event'>('newest');
  /*
   * Which rows are open. A set rather than one id: a provider comparing two
   * quotations should not have the first collapse when they open the second,
   * and a dashboard that deep-links one booking opens exactly that one.
   */
  const highlighted = params.get('highlight');
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(highlighted ? [highlighted] : []),
  );
  // A booking named in the link — from a notification, or a dashboard row —
  // arrives open. After that the set is the only thing that decides, so the
  // next press closes it like any other.
  useEffect(() => {
    if (highlighted) setOpen((current) => new Set(current).add(highlighted));
  }, [highlighted]);

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
      if (tab === 'request_on_date' && !isRequestOnDate(b)) return false;
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
    // Counted from the rows, not the server's per-status tally: the server
    // counts statuses and this tab is not one (EZ1-I227).
    if (entry.key === 'request_on_date') return all.filter(isRequestOnDate).length;
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
                <div className="flex min-w-0 gap-3">
                  {/* The client's photo, so the provider recognises who they are
                      dealing with without opening the profile (EZ1-I109). */}
                  {booking.clientPhoto && (
                    <img
                      src={booking.clientPhoto}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-inset ring-gray-900/5"
                      loading="lazy"
                    />
                  )}
                  <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {/* The real customer/couple name; "Customer" only when the
                        record genuinely has no name (EZ1-I33), never "A client". */}
                    {booking.clientName ?? 'Customer'}
                    {booking.serviceName && (
                      <span className="font-normal text-gray-500"> · {booking.serviceName}</span>
                    )}
                    {booking.offeringName && (
                      <span className="font-normal text-gray-400"> · {booking.offeringName}</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    Asked {formatDate(booking.createdAt)} · {booking.id.slice(0, 8)}
                  </p>
                  {/* The customer's own contact and location, so the provider can
                      reach them and place the event without opening another
                      screen (EZ1-I109). */}
                  {(booking.clientPhone || booking.clientEmail || booking.clientCity || booking.eventCity) && (
                    <p className="mt-0.5 text-xs text-gray-500">
                      {[booking.clientPhone, booking.clientEmail, booking.clientCity ?? booking.eventCity]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-gray-700">
                    {statusLabels[booking.status] ?? booking.status.replace(/_/g, ' ')}
                  </span>
                  {/* Marked on the row as well as gathered under its own tab, so
                      it reads as one wherever the provider comes across it
                      (EZ1-I227). */}
                  {isRequestOnDate(booking) && (
                    <span
                      className="rounded-full bg-caution-bg px-2 py-0.5 text-xs text-caution-fg"
                      title="The customer asked for a date you have not published. Check it before quoting."
                    >
                      Request on date
                    </span>
                  )}
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
                {/*
                  The number the customer actually entered when they asked
                  (EZ1-I78): the booking amount is 0 until a quote is agreed, so
                  without this the vendor saw INR 0 and could not tell what the
                  customer had in mind.
                */}
                {booking.expectedBudget && Number(booking.expectedBudget) > 0 && (
                  <div className="flex items-center gap-1.5">
                    <dt className="text-gray-400">Customer budget</dt>
                    <dd className="font-mono">
                      {booking.currency} {Number(booking.expectedBudget).toLocaleString('en-IN')}
                    </dd>
                  </div>
                )}
              </dl>

              {/* The one thing waiting on the provider, so the queue reads as a
                  to-do list rather than a wall of statuses (EZ1-I68). */}
              {NEXT_ACTION[booking.status] && (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  Next: {NEXT_ACTION[booking.status]}
                </p>
              )}

              {/* Why a cancelled booking was cancelled, and by whom (EZ1-I68/I77). */}
              {booking.status === 'cancelled' &&
                (booking.cancellationReason || booking.cancelledByName) && (
                  <p className="mt-2 rounded-sm bg-red-50 p-2 text-xs text-red-800">
                    Cancelled
                    {booking.cancelledByName
                      ? ` by ${booking.cancelledByName}${
                          booking.cancelledByRole ? ` (${booking.cancelledByRole})` : ''
                        }`
                      : ''}
                    {booking.cancellationReason ? ` — ${booking.cancellationReason}` : ''}
                  </p>
                )}

              {renderDetail && (
                <>
                  <button
                    type="button"
                    className="btn-ghost btn-sm mt-2"
                    aria-expanded={open.has(booking.id)}
                    onClick={() =>
                      setOpen((current) => {
                        const next = new Set(current);
                        if (next.has(booking.id)) next.delete(booking.id);
                        else next.add(booking.id);
                        return next;
                      })
                    }
                  >
                    {open.has(booking.id) ? 'Hide detail' : 'Show detail'}
                  </button>
                  {open.has(booking.id) && renderDetail(booking)}
                </>
              )}

              {booking.requirements && (
                <p className="mt-2 rounded-sm bg-surface-sunken p-2 text-xs text-gray-700">
                  {booking.requirements}
                </p>
              )}

              {/* A free-text note the customer left on the request (EZ1-I109). */}
              {booking.notes && (
                <p className="mt-2 rounded-sm bg-surface-sunken p-2 text-xs text-gray-700">
                  <span className="text-gray-400">Note: </span>
                  {booking.notes}
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
