import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { BOOKING_STATUS_LABEL, MILESTONE_LABEL, Permission, can, canAny } from '../lib/permissions';
import ProviderBookings from '../components/ProviderBookings';
import BookingChat from '../components/BookingChat';
import PaymentMethodPicker from '../components/PaymentMethodPicker';
import PhotoUploader from '../components/PhotoUploader';
import ConfirmDialog from '../components/ConfirmDialog';
import { Loading } from '../components/ui/Feedback';

interface Booking {
  id: string;
  userId: string;
  bookedByUserId: string;
  providerType: 'vendor' | 'planner';
  providerId: string;
  providerName?: string;
  requirements?: string | null;
  expectedBudget?: string | null;
  amount: string;
  currency: string;
  status: string;
  eventDate: string | null;
}

interface Quotation {
  id: string;
  amount: string;
  currency: string;
  lines: { description: string; amount: number }[];
  notes: string | null;
  validUntil: string | null;
  terms: string | null;
  status: string;
}

type MilestoneKey = 'advance' | 'second' | 'final';

interface Milestone {
  milestone: MilestoneKey;
  amount: string;
  status: string | null;
  paymentId: string | null;
}

interface MilestoneView {
  bookingId: string;
  total: string;
  currency: string;
  milestones: Milestone[];
}

/**
 * Which instalment the booking's own state makes payable.
 *
 * Money and work alternate: the advance secures the job, the second releases
 * the provider to finish it, the balance falls due once they say it is done.
 * The server enforces this; mirroring it here means the button appears at the
 * moment it will actually work rather than producing a refusal.
 */
const PAYABLE_AT: Record<MilestoneKey, string[]> = {
  advance: ['payment_pending'],
  second: ['in_progress'],
  final: ['completed_pending_final_payment'],
};

const OPEN_STATUSES = [
  'requested',
  'quotation_sent',
  'quotation_accepted',
  'payment_pending',
  'pending',
  'confirmed',
  'in_progress',
];

/**
 * The buyer's side of a booking.
 *
 * A wedding job is priced by quotation, not from a listing, so the flow reads:
 * request, receive a quote, accept it, then pay in three instalments. Confirm,
 * start and complete belong to the provider and are absent here — the server
 * refuses them from this side anyway.
 */
export default function Bookings() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const canBuy = can(permissions, Permission.BOOKING_READ_OWN);
  const canPay = can(permissions, Permission.BOOKING_PAY);
  const canRaiseCase = can(permissions, Permission.CASE_RAISE);
  const canSell = can(permissions, Permission.BOOKING_READ_INCOMING);
  // A planner answers an incoming request the same way a vendor does — with a
  // quotation — but only the vendor permission was checked here, so a planner
  // saw nothing but Decline (EZ1-I67). The server already lets either seller quote.
  const canQuote = canAny(permissions, [
    Permission.VENDOR_LISTING_MANAGE,
    Permission.PLANNER_LISTING_MANAGE,
  ]);

  const [params] = useSearchParams();
  const highlight = params.get('highlight');

  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  // Arriving from a fresh request opens that booking straight away, so the
  // person is looking at the thing they just did rather than hunting for it.
  const [expanded, setExpanded] = useState<string | null>(highlight);
  const [disputing, setDisputing] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  /*
   * Which booking is being cancelled, if any.
   *
   * This used to go through on the first click: a provider's held date
   * released and escrow unwound before anybody could think better of it.
   */
  const [cancelling, setCancelling] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['bookings', status],
    queryFn: async () => (await api.get('/bookings', { params: status ? { status } : {} })).data,
    enabled: canBuy,
  });

  async function run(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['bookings'] });
      qc.invalidateQueries({ queryKey: ['quotations'] });
      qc.invalidateQueries({ queryKey: ['milestones'] });
    } catch (err) {
      setError(apiMessage(err, 'That action was rejected.'));
    }
  }

  // A provider does not buy; they answer. Same module, the other side of it —
  // which is where the work belongs, rather than duplicated on the business
  // page where it drifts out of step.
  if (!canBuy) {
    if (!canSell) {
      return (
        <div className="card">
          <h1 className="page-title">Bookings</h1>
          <p className="page-subtitle">
            Your account does not book services.
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-6">
        <div>
          <h1 className="page-title">Bookings</h1>
          <p className="page-subtitle">
            Everything coming in against your listings, in the order the work moves. Accepting a
            job is what takes the window off your calendar.
          </p>
        </div>
        <ProviderBookings canQuote={canQuote} />
      </div>
    );
  }

  const bookings: Booking[] = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Bookings &amp; Escrow</h1>
        <select
          className="input max-w-xs"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {[...OPEN_STATUSES, 'completed', 'disputed', 'cancelled'].map((s) => (
            <option key={s} value={s}>
              {BOOKING_STATUS_LABEL[s] ?? s}
            </option>
          ))}
        </select>
      </div>

      <p className="text-sm text-gray-500">
        Ask for a booking from the <strong>Vendors</strong> or <strong>Planners</strong> page. The
        provider quotes; once you accept, the price is fixed and payable in three instalments held
        in escrow. Money reaches the provider only when the work is marked delivered.
      </p>

      {error && <p className="alert-critical">{error}</p>}
      {isLoading && <Loading rows={3} />}

      <div className="space-y-3">
        {!isLoading && bookings.length === 0 && (
          <p className="card text-sm text-gray-400">No bookings yet.</p>
        )}
        {bookings.map((b) => (
          <div
            key={b.id}
            className={`card space-y-3 ${highlight === b.id ? 'ring-2 ring-brand' : ''}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-gray-900">
                  {b.providerName ?? `${b.providerType} ${b.providerId.slice(0, 8)}`}
                </p>
                <p className="text-sm text-gray-500">
                  <span className="uppercase tracking-wide text-gray-400">{b.providerType}</span>
                  {Number(b.amount) > 0 ? ` · ${b.currency} ${b.amount}` : ' · not yet priced'}
                  {b.eventDate ? ` · ${b.eventDate}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                  {BOOKING_STATUS_LABEL[b.status] ?? b.status}
                </span>
                <button
                  className="btn-outline"
                  onClick={() => setExpanded(expanded === b.id ? null : b.id)}
                >
                  {expanded === b.id ? 'Hide' : 'Details'}
                </button>
                {OPEN_STATUSES.includes(b.status) && (
                  <button className="btn-outline" onClick={() => setCancelling(b.id)}>
                    Cancel
                  </button>
                )}
                {canRaiseCase &&
                  ['confirmed', 'in_progress', 'completed_pending_final_payment', 'completed'].includes(
                    b.status,
                  ) && (
                    <button
                      className="btn-outline text-red-600"
                      onClick={() => setDisputing(disputing === b.id ? null : b.id)}
                    >
                      {disputing === b.id ? 'Never mind' : 'Raise an issue'}
                    </button>
                  )}
                {/*
                  A review can only be written after the job is done, and only
                  once per booking — the server finds the completed, unreviewed
                  booking for this vendor and refuses a second (EZ1-I30).
                */}
                {b.status === 'completed' && b.providerType === 'vendor' && (
                  <button
                    className="btn-outline"
                    onClick={() => setReviewing(reviewing === b.id ? null : b.id)}
                  >
                    {reviewing === b.id ? 'Never mind' : 'Write a review'}
                  </button>
                )}
              </div>
            </div>

            {reviewing === b.id && (
              <ReviewForm booking={b} onCancel={() => setReviewing(null)} />
            )}

            {disputing === b.id && (
              <DisputeForm
                booking={b}
                onCancel={() => setDisputing(null)}
                onRaise={async (body) => {
                  await run(() => api.post('/verification/cases', body));
                  setDisputing(null);
                }}
              />
            )}

            {expanded === b.id && (
              <BookingDetail booking={b} canPay={canPay} onRun={run} />
            )}

            {/*
              Asked before the date is released.

              A cancellation unwinds escrow and hands the provider's held window
              back, and neither is something the platform can put right
              afterwards — so the sentence names what is lost rather than
              asking a generic "are you sure".
            */}
            {cancelling === b.id && (
              <ConfirmDialog
                title="Cancel this booking?"
                body={
                  Number(b.amount) > 0
                    ? `${b.providerName ?? 'The provider'} will lose the date, and anything held in escrow is returned. This cannot be undone.`
                    : `${b.providerName ?? 'The provider'} will be told you no longer need them. This cannot be undone.`
                }
                confirmLabel="Confirm cancellation"
                cancelLabel="Keep booking"
                onDismiss={() => setCancelling(null)}
                onConfirm={async () => {
                  await run(() => api.put(`/bookings/${b.id}/cancel`, {}));
                  setCancelling(null);
                }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Quotations, grouped by what became of them.
 *
 * A re-quoted booking shows four rows differing only by a status word in the
 * corner, and the one that matters — the offer that was actually agreed — is
 * not necessarily the newest. Superseded and expired go together because they
 * mean the same thing to a reader: an offer that is no longer on the table and
 * nobody refused.
 */
const QUOTE_GROUPS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'live', label: 'On the table', statuses: ['sent'] },
  { key: 'accepted', label: 'Accepted', statuses: ['accepted'] },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'] },
  { key: 'past', label: 'No longer current', statuses: ['superseded', 'expired'] },
];

/** Why a milestone that is next in line still is not payable. */
const WAITING_ON: Record<MilestoneKey, string> = {
  advance: 'Waiting on the provider to accept',
  second: 'Due once they start the work',
  final: 'Due once they mark it delivered',
};

/** Rate and review a completed vendor booking, once (EZ1-I30). */
function ReviewForm({ booking, onCancel }: { booking: Booking; onCancel: () => void }) {
  const qc = useQueryClient();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post(`/vendors/${booking.providerId}/reviews`, {
        rating,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setDone(true);
      qc.invalidateQueries({ queryKey: ['bookings'] });
    } catch (err) {
      setError(apiMessage(err, 'That review could not be submitted.'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-3 rounded-sm border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
        Review submitted. Thank you.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-sm border border-gray-200 p-3">
      <div>
        <p className="text-sm font-medium text-gray-900">
          Rate {booking.providerName ?? 'this service'}
        </p>
        <div className="mt-1 flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
              className={`text-2xl leading-none ${n <= rating ? 'text-amber-500' : 'text-gray-300'}`}
            >
              ★
            </button>
          ))}
        </div>
      </div>
      <label className="block text-sm">
        <span className="text-gray-700">Your review</span>
        <textarea
          className="input mt-1"
          rows={3}
          maxLength={2000}
          placeholder="Share your experience…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button className="btn" disabled={busy}>
          Submit review
        </button>
        <button type="button" className="btn-outline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The booking lifecycle, as one row a buyer can read at a glance (EZ1-I12).
 * A cancelled or disputed booking has left the happy path and is shown as a
 * badge instead of a stage.
 */
const LIFECYCLE: { key: string; label: string }[] = [
  { key: 'requested', label: 'Request' },
  { key: 'quotation_sent', label: 'Quotation' },
  { key: 'quotation_accepted', label: 'Accepted' },
  { key: 'payment_pending', label: 'Payment' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
];

const STAGE_INDEX: Record<string, number> = {
  requested: 0,
  quotation_sent: 1,
  quotation_accepted: 2,
  payment_pending: 3,
  confirmed: 4,
  in_progress: 5,
  completed_pending_final_payment: 6,
  completed: 6,
};

function BookingProgress({ status }: { status: string }) {
  if (status === 'cancelled' || status === 'disputed') {
    return (
      <span
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          status === 'cancelled' ? 'bg-gray-100 text-gray-600' : 'bg-red-50 text-red-700'
        }`}
      >
        {BOOKING_STATUS_LABEL[status] ?? status}
      </span>
    );
  }
  const at = STAGE_INDEX[status] ?? -1;
  if (at < 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      {LIFECYCLE.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1">
          <span
            className={`rounded-full px-2 py-0.5 ${
              i === at
                ? 'bg-brand text-white'
                : i < at
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-gray-100 text-gray-500'
            }`}
          >
            {s.label}
          </span>
          {i < LIFECYCLE.length - 1 && <span className="text-gray-300">→</span>}
        </span>
      ))}
    </div>
  );
}

function BookingDetail({
  booking,
  canPay,
  onRun,
}: {
  booking: Booking;
  canPay: boolean;
  onRun: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { data: quotations } = useQuery({
    queryKey: ['quotations', booking.id],
    queryFn: async () =>
      (await api.get(`/bookings/${booking.id}/quotations`)).data as Quotation[],
    retry: false,
  });

  const { data: milestones } = useQuery({
    queryKey: ['milestones', booking.id],
    queryFn: async () =>
      (await api.get(`/bookings/${booking.id}/milestones`)).data as MilestoneView,
    retry: false,
  });

  /*
   * Which method the next instalment uses.
   *
   * Card unless the person says otherwise, and per booking rather than
   * remembered across the page: somebody may reasonably settle a small
   * balance in cash and put the deposit on a card, and carrying the last
   * choice over would quietly pick the wrong one.
   */
  const [method, setMethod] = useState('card');

  const live = (quotations ?? []).find((q) => q.status === 'sent');
  const paid = new Set(
    (milestones?.milestones ?? [])
      .filter((m) => m.status && m.status !== 'refunded' && m.status !== 'failed')
      .map((m) => m.milestone),
  );
  const nextDue = (milestones?.milestones ?? []).find((m) => !paid.has(m.milestone));
  const dueNow =
    nextDue && PAYABLE_AT[nextDue.milestone].includes(booking.status) ? nextDue.milestone : null;

  return (
    <div className="space-y-4 border-t pt-3">
      {/* Where this booking has got to, at a glance (EZ1-I12). */}
      <div>
        <h3 className="section-title text-sm">Progress</h3>
        <div className="mt-1">
          <BookingProgress status={booking.status} />
        </div>
      </div>

      <div>
        <h3 className="section-title text-sm">Quotations</h3>
        {(quotations ?? []).length === 0 && (
          <p className="text-sm text-gray-500">
            The provider has not priced this yet. They will send a quotation.
          </p>
        )}
        {/*
          Grouped by what became of them. A booking that has been re-quoted
          three times shows four rows that differ only by a status word in the
          corner, and the one that matters — the offer that was agreed — is not
          necessarily the newest. The heading says which pile you are looking
          at.
        */}
        {QUOTE_GROUPS.map(({ key, label, statuses }) => {
          const inGroup = (quotations ?? []).filter((q) => statuses.includes(q.status));
          if (inGroup.length === 0) return null;
          return (
            <div key={key} className="mt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {label}
              </p>
              {inGroup.map((q) => (
          <div key={q.id} className="mt-2 rounded-sm bg-gray-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {q.currency} {q.amount}
              </p>
              <span className="text-xs capitalize text-gray-500">{q.status}</span>
            </div>
            {q.lines.length > 0 && (
              <ul className="mt-1 text-sm text-gray-600">
                {q.lines.map((l, i) => (
                  <li key={i} className="flex justify-between">
                    <span>{l.description}</span>
                    <span className="tabular-nums">{l.amount}</span>
                  </li>
                ))}
              </ul>
            )}
            {q.notes && <p className="mt-1 text-sm text-gray-600">{q.notes}</p>}
            {q.terms && (
              <div className="mt-2 rounded-sm border border-gray-200 bg-surface p-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Terms
                </p>
                <p className="whitespace-pre-wrap text-sm text-gray-700">{q.terms}</p>
              </div>
            )}
            {q.validUntil && (
              <p className="mt-1 text-xs text-gray-500">
                Valid until {new Date(q.validUntil).toLocaleDateString()}
              </p>
            )}
            {live?.id === q.id && canPay && (
              <div className="mt-2 flex gap-2">
                <button
                  className="btn"
                  onClick={() => onRun(() => api.put(`/bookings/quotations/${q.id}/accept`, {}))}
                >
                  Accept this quotation
                </button>
                <button
                  className="btn-outline"
                  onClick={() => onRun(() => api.put(`/bookings/quotations/${q.id}/reject`, {}))}
                >
                  Ask them to re-quote
                </button>
              </div>
            )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {milestones && (
        <div>
          <h3 className="section-title text-sm">Instalments</h3>
          <p className="text-xs text-gray-500">
            Paid in order. Everything held is released to the provider when the work is delivered.
          </p>
          <div className="mt-2 divide-y">
            {milestones.milestones.map((m) => (
              <div key={m.milestone} className="flex items-center justify-between py-2">
                <div>
                  <p className="text-sm font-medium">{MILESTONE_LABEL[m.milestone]}</p>
                  <p className="text-xs text-gray-500">
                    {milestones.currency} {m.amount}
                  </p>
                </div>
                {m.status ? (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-700">
                    {m.status.replace(/_/g, ' ')}
                  </span>
                ) : canPay && dueNow === m.milestone ? (
                  <div className="flex flex-col items-end gap-2">
                    <PaymentMethodPicker value={method} onChange={setMethod} amount={m.amount} />
                    <button
                      className="btn"
                      onClick={() =>
                        onRun(() =>
                          api.put(`/bookings/${booking.id}/pay`, {
                            milestone: m.milestone,
                            method,
                          }),
                        )
                      }
                    >
                      Pay
                    </button>
                  </div>
                ) : (
                  <span className="text-xs text-gray-400">
                    {nextDue?.milestone === m.milestone
                      ? WAITING_ON[m.milestone]
                      : 'Not due yet'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <BookingChat bookingId={booking.id} />
    </div>
  );
}

/**
 * Raising a dispute.
 *
 * A prompt box asking "what went wrong?" produced two sentences of prose and
 * nothing else, and an officer deciding whether to release fifty thousand
 * rupees was doing it on that. This asks for the two things that actually
 * decide the case: which instalment is in question, and what proof there is.
 */
function DisputeForm({
  booking,
  onRaise,
  onCancel,
}: {
  booking: Booking;
  onRaise: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [milestone, setMilestone] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [url, setUrl] = useState('');

  const ready = title.trim().length >= 3 && description.trim().length >= 10;

  return (
    <form
      className="space-y-3 border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        onRaise({
          subjectType: 'booking',
          subjectId: booking.id,
          title: title.trim(),
          description: description.trim(),
          ...(milestone ? { milestone } : {}),
          ...(evidence.length ? { evidence } : {}),
        });
      }}
    >
      <p className="text-sm text-gray-600">
        An officer investigates. Everything held in escrow on this booking stays frozen until they
        decide, neither side can move it in the meantime.
      </p>

      <label className="block text-sm">
        <span className="text-gray-700">In one line, what happened?</span>
        <input
          className="input mt-1"
          placeholder="Photographer did not attend the reception"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className="block text-sm">
        <span className="text-gray-700">Tell them the whole story</span>
        <textarea
          className="input mt-1"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <label className="block text-sm">
        <span className="text-gray-700">Which payment is this about?</span>
        <select
          className="input mt-1"
          value={milestone}
          onChange={(e) => setMilestone(e.target.value)}
        >
          <option value="">Not about a specific payment</option>
          {(Object.keys(MILESTONE_LABEL) as MilestoneKey[]).map((key) => (
            <option key={key} value={key}>
              {MILESTONE_LABEL[key]}
            </option>
          ))}
        </select>
      </label>

      <div>
        <p className="label">Evidence</p>
        <p className="text-xs text-gray-500">
          Photographs, invoices, message screenshots. Anything that shows what you are describing.
        </p>
        {evidence.length > 0 && (
          <ul className="mt-1 space-y-1 text-sm text-gray-700">
            {evidence.map((e) => (
              <li key={e} className="flex items-center justify-between gap-2">
                <span className="truncate">{e}</span>
                <button
                  type="button"
                  className="text-xs text-gray-500 underline"
                  onClick={() => setEvidence((list) => list.filter((u) => u !== e))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            className="input flex-1"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            type="button"
            className="btn-outline"
            disabled={!/^https?:\/\/\S+$/.test(url.trim())}
            onClick={() => {
              setEvidence((list) => [...list, url.trim()]);
              setUrl('');
            }}
          >
            Add
          </button>
          {/*
            The copy asked for invoices and screenshots and then offered a box
            for a URL, which meant uploading the thing somewhere else first.
            Almost nobody does that, so disputes arrived with prose and no
            proof — and an officer decided them on the prose.
          */}
          <PhotoUploader
            kind="attachment"
            label="Upload a file"
            onUploaded={(u) => setEvidence((list) => [...list, u])}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn" disabled={!ready}>
          Raise the issue
        </button>
        <button type="button" className="btn-outline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
