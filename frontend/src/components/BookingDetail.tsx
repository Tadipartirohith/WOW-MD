import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/dates';
import { BOOKING_STATUS_LABEL, MILESTONE_LABEL } from '../lib/permissions';

/**
 * Everything about one booking, behind the fold.
 *
 * The row above it carries what the next decision is made on. This is the rest
 * of the record, which a provider previously had to piece together from the
 * list, the Accounts ledger and their own memory of what they quoted
 * (EZ1-I252): the reference, the customer, the event, the package, what was
 * quoted and what was agreed, what has actually been paid and what is still
 * held in escrow, and the order it all happened in.
 *
 * Cards in the order the questions get asked — who and what for, what was
 * sold, what else was asked for, where the money is — and the same order in the
 * app, because a provider who has looked a booking up on one of them should not
 * have to learn the other (EZ1-I260).
 *
 * Nothing is repeated from the row above: the customer's phone and email, the
 * guest count, the date it was asked for and the budget they named are all on
 * the row already, and printing them again under a heading is what made this
 * read as a dump rather than a record.
 *
 * The quotation and the timeline are one press further in. They are what
 * somebody reaches for when a figure is disputed rather than when a job is
 * being worked.
 *
 * Every figure is read live from the endpoint that owns it — quotations,
 * milestones, history — rather than computed from the copy on the row.
 */
interface DetailBooking {
  id: string;
  status: string;
  amount: string;
  currency: string;
  eventDate: string | null;
  createdAt: string;
  requirements: string | null;
  notes?: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  eventName: string | null;
  eventVenue: string | null;
  eventCity: string | null;
  expectedGuests: number | null;
  serviceName: string | null;
  offeringName?: string | null;
  expectedBudget?: string | null;
  paymentStatus: string | null;
  quantity?: number | null;
}

interface Quotation {
  id: string;
  amount: string;
  currency: string;
  status: string;
  notes: string | null;
  validUntil: string | null;
  createdAt: string;
}

interface Milestones {
  total: string;
  currency: string;
  milestones: { milestone: string; amount: string; status: string | null }[];
}

type HistoryEvent = { at: string; label: string; detail: string | null };

/** A payment in one of these states has not actually been collected. */
const UNPAID = ['failed', 'refunded'];

const PAYMENT_LABEL: Record<string, string> = {
  initiated: 'Payment started',
  held_in_escrow: 'Held in escrow',
  disputed: 'Disputed',
  pending_payout: 'Owed to you',
  released: 'Paid out',
  refunded: 'Refunded',
  partially_settled: 'Part settled',
};

export default function BookingDetail({
  booking,
  extras,
}: {
  booking: DetailBooking;
  /** What else belongs to this booking — the form answers, the brief, the
   *  add-ons — placed between what was sold and what is owed. */
  extras?: React.ReactNode;
}) {
  const [showRecord, setShowRecord] = useState(false);

  const quotations = useQuery({
    queryKey: ['booking-quotations', booking.id],
    queryFn: async () => (await api.get(`/bookings/${booking.id}/quotations`)).data as Quotation[],
    enabled: showRecord,
    retry: false,
  });

  const milestones = useQuery({
    queryKey: ['booking-milestones', booking.id],
    queryFn: async () => (await api.get(`/bookings/${booking.id}/milestones`)).data as Milestones,
    retry: false,
  });

  const history = useQuery({
    queryKey: ['booking-history', booking.id],
    queryFn: async () => (await api.get(`/bookings/${booking.id}/history`)).data as HistoryEvent[],
    enabled: showRecord,
    retry: false,
  });

  // The live offer, which is the last one sent: re-quoting supersedes rather
  // than edits, so the older rows are history and not the price.
  const quotation = quotations.data?.[0] ?? null;
  const rows = milestones.data?.milestones ?? [];
  const currency = milestones.data?.currency ?? booking.currency;

  const paid = rows
    .filter((row) => row.status && !UNPAID.includes(row.status))
    .reduce((total, row) => total + Number(row.amount || 0), 0);
  const total = Number(milestones.data?.total ?? booking.amount ?? 0);
  const remaining = Math.max(0, total - paid);
  const money = (value: string | number) =>
    `${currency} ${Number(value || 0).toLocaleString('en-IN')}`;

  return (
    <div className="mt-2 space-y-3 border-t border-gray-200 pt-2 text-xs">
      <Section title="Booking">
        <Row label="Booking ID">
          <span className="font-mono">{booking.id}</span>
        </Row>
        <Row label="Status">{BOOKING_STATUS_LABEL[booking.status] ?? booking.status}</Row>
        <Row label="Customer">{booking.clientName ?? 'Customer'}</Row>
        <Row label="Event">{booking.eventName ?? '—'}</Row>
        <Row label="Date">{formatDate(booking.eventDate)}</Row>
        <Row label="Venue">
          {[booking.eventVenue, booking.eventCity].filter(Boolean).join(', ') || '—'}
        </Row>
      </Section>

      <Section title="Service">
        <Row label="Service">{booking.serviceName ?? '—'}</Row>
        {booking.offeringName && <Row label="Package">{booking.offeringName}</Row>}
        {booking.quantity ? <Row label="Quantity">{booking.quantity}</Row> : null}
        <Row label="Price">{money(booking.amount)}</Row>
        {booking.requirements && (
          <p className="mt-1 text-gray-700 sm:col-span-2">
            <span className="text-gray-400">What they asked for: </span>
            {booking.requirements}
          </p>
        )}
        {booking.notes && (
          <p className="mt-1 text-gray-700 sm:col-span-2">
            <span className="text-gray-400">Note: </span>
            {booking.notes}
          </p>
        )}
      </Section>

      {extras}

      {showRecord && quotation && (
        <Section title="Quotation">
          <Row label="Quoted">
            {`${quotation.currency} ${Number(quotation.amount).toLocaleString('en-IN')}`}
          </Row>
          <Row label="Status">{quotation.status.replace(/_/g, ' ')}</Row>
          <Row label="Sent">{formatDate(quotation.createdAt)}</Row>
          {quotation.validUntil && <Row label="Valid until">{formatDate(quotation.validUntil)}</Row>}
          {quotation.notes && <p className="mt-1 text-gray-700 sm:col-span-2">{quotation.notes}</p>}
        </Section>
      )}

      <Section title="Payment">
        <Row label="Total">{money(total)}</Row>
        <Row label="Paid">{money(paid)}</Row>
        <Row label="Remaining">{money(remaining)}</Row>
        {booking.paymentStatus && (
          <Row label="Escrow">
            {PAYMENT_LABEL[booking.paymentStatus] ?? booking.paymentStatus.replace(/_/g, ' ')}
          </Row>
        )}
        {/* The instalments, separately: an advance that has cleared and a
            balance that has not are two different facts about the same job. */}
        {rows.length > 0 && (
          <ul className="mt-1 space-y-0.5 sm:col-span-2">
            {rows.map((row) => (
              <li key={row.milestone} className="flex items-center justify-between gap-2">
                <span className="text-gray-600">
                  {MILESTONE_LABEL[row.milestone] ?? row.milestone.replace(/_/g, ' ')}
                </span>
                <span className="font-mono">{money(row.amount)}</span>
                <span className={row.status && !UNPAID.includes(row.status) ? '' : 'text-gray-400'}>
                  {row.status
                    ? (PAYMENT_LABEL[row.status] ?? row.status.replace(/_/g, ' '))
                    : 'Not due yet'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {showRecord && history.data && history.data.length > 0 && (
        <Section title="History">
          <ol className="space-y-1 sm:col-span-2">
            {history.data.map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <span className="text-gray-700">{event.label}</span>
                <span className="text-gray-400">
                  {' · '}
                  {[formatDateTime(event.at), event.detail].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <button
        type="button"
        className="btn-ghost btn-sm"
        aria-expanded={showRecord}
        onClick={() => setShowRecord((open) => !open)}
      >
        {showRecord ? 'Hide quotation and history' : 'Quotation and history'}
      </button>
    </div>
  );
}

/**
 * A titled block of facts, two columns where there is room for two.
 *
 * A plain grid rather than a definition list: these sections carry a paragraph
 * and an instalment table alongside their label/value pairs, and neither is
 * something a `dl` may contain.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-gray-400">
        {title}
      </h4>
      <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="shrink-0 text-gray-400">{label}</span>
      <span className="min-w-0 break-words text-gray-800">{children}</span>
    </div>
  );
}
