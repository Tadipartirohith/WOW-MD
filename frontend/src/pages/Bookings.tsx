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
  /** Wedding/service context, already returned by listForBuyer (EZ1-I68). */
  eventName?: string | null;
  eventVenue?: string | null;
  eventCity?: string | null;
  expectedGuests?: number | null;
  serviceName?: string | null;
  offeringName?: string | null;
  paymentStatus?: string | null;
  /** Cancellation detail, when the booking is cancelled (EZ1-I77). */
  cancellationReason?: string | null;
  cancelledByName?: string | null;
  cancelledByRole?: string | null;
  cancelledAt?: string | null;
  /** The buyer's own review of this booking, when written (EZ1-I114). */
  myReview?: { rating: number; comment: string } | null;
  /** True when this row is the match-fixed partner's booking, not the caller's (EZ1-I160). */
  sharedFromPartner?: boolean;
  /** The client the booking is for — the partner's name on a shared row (EZ1-I160). */
  clientName?: string | null;
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
 * The status filter, curated into the buckets a buyer actually thinks in
 * (EZ1-I167). Each tab maps to one or more raw statuses; 'active' stays a
 * client-side group for dashboard deep-links (EZ1-I75), and an exact-status
 * link still falls through to a direct match.
 */
const TAB_DEFS: { key: string; label: string; statuses: string[] }[] = [
  { key: '', label: 'All', statuses: [] },
  { key: 'requested', label: 'Requests', statuses: ['requested'] },
  { key: 'quotation', label: 'Quotation', statuses: ['quotation_sent', 'quotation_accepted'] },
  { key: 'payment', label: 'Payment', statuses: ['payment_pending', 'pending'] },
  { key: 'confirmed', label: 'Confirmed', statuses: ['confirmed'] },
  { key: 'in_progress', label: 'In Progress', statuses: ['in_progress'] },
  {
    key: 'completed',
    label: 'Completed',
    statuses: ['completed', 'completed_pending_final_payment'],
  },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
];

/** A plain-English line under the technical status, per status (EZ1-I167). */
const STATUS_HINT: Record<string, string> = {
  requested: 'Request sent — waiting for the provider to send a quotation.',
  quotation_sent: 'Quotation received — review it, then accept or decline.',
  quotation_accepted: 'Quotation accepted — complete payment to confirm your booking.',
  payment_pending: 'Payment pending — complete payment to confirm your booking.',
  pending: 'Paid — waiting for the provider to confirm.',
  confirmed: 'Confirmed — booking confirmed successfully.',
  in_progress: 'In progress — your booking is currently being fulfilled.',
  completed_pending_final_payment: 'Service delivered — pay the balance to close the booking.',
  completed: 'Completed — service completed.',
  disputed: 'Under investigation — an officer is reviewing this booking.',
  cancelled: 'Cancelled — this booking was cancelled.',
};

/** The contextual empty state for a filter that has no bookings (EZ1-I167). */
const EMPTY_HINT: Record<string, string> = {
  '': 'No bookings yet — request one from the Vendors or Hire a Planner page.',
  requested: 'No open requests — requests you send sit here until the provider quotes.',
  quotation: 'No quotations yet — a provider’s price for your request will show up here.',
  payment: 'Nothing awaiting payment — accepted quotations that need paying appear here.',
  confirmed: 'No confirmed bookings yet.',
  in_progress: 'Nothing in progress right now.',
  completed: 'No completed bookings yet.',
  cancelled: 'No cancelled bookings.',
};

/** The single prominent action per status; everything else stays secondary (EZ1-I167). */
const PRIMARY_LABEL: Record<string, string> = {
  quotation_sent: 'View quotation',
  quotation_accepted: 'Complete payment',
  payment_pending: 'Complete payment',
  completed_pending_final_payment: 'Pay balance',
};

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

  // A dashboard tile can deep-link to a bucket (EZ1-I75). 'active' is a group
  // (everything not cancelled or completed) rather than one status, so it is
  // filtered on the client; the exact statuses pass straight to the API.
  const [status, setStatus] = useState(params.get('status') ?? '');
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
  const [cancelReason, setCancelReason] = useState('');

  // Every booking is fetched once and filtered on the client (EZ1-I141): that is
  // what lets the status tabs carry live counts and switch without a round-trip.
  const { data, isLoading } = useQuery({
    queryKey: ['bookings'],
    queryFn: async () => (await api.get('/bookings')).data,
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

  const allBookings: Booking[] = data?.data ?? [];
  const matchesTab = (b: Booking, tab: string): boolean => {
    if (tab === '') return true;
    if (tab === 'active') return b.status !== 'cancelled' && b.status !== 'completed';
    // A curated tab matches its group of statuses; an exact-status deep link
    // (EZ1-I75) still falls through to a direct match.
    const def = TAB_DEFS.find((t) => t.key === tab);
    return def ? def.statuses.includes(b.status) : b.status === tab;
  };
  const bookings: Booking[] = allBookings.filter((b) => matchesTab(b, status));
  const countFor = (tab: string) => allBookings.filter((b) => matchesTab(b, tab)).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Bookings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Ask for a booking from the <strong>Vendors</strong> or <strong>Hire a Planner</strong>{' '}
          page. The provider quotes; once you accept, the price is fixed and payable in
          instalments. Payments and escrow are on the <strong>Accounts</strong> page.
        </p>
      </div>

      {/*
        Curated status filter with live counts (EZ1-I141, EZ1-I167). Kept on one
        line and horizontally scrollable so it never wraps into crowded rows on
        mobile; the selected tab is highlighted.
      */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TAB_DEFS.map((t) => {
          const n = countFor(t.key);
          const activeTab = status === t.key;
          return (
            <button
              key={t.key || 'all'}
              onClick={() => setStatus(t.key)}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-sm transition-colors ${
                activeTab
                  ? 'border-brand bg-brand-light text-brand-dark'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 tabular-nums ${activeTab ? 'text-brand-dark' : 'text-gray-400'}`}>
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {error && <p className="alert-critical">{error}</p>}
      {isLoading && <Loading rows={3} />}

      <div className="space-y-3">
        {!isLoading && bookings.length === 0 && (
          <p className="card text-sm text-gray-500">
            {EMPTY_HINT[status] ?? 'No bookings here.'}
          </p>
        )}
        {bookings.map((b) => {
          const priced = Number(b.amount) > 0;
          // "Category · Location" — what was booked, and where the event is.
          const category = b.serviceName ?? (b.providerType === 'planner' ? 'Planner' : 'Vendor');
          const location = [b.eventVenue, b.eventCity].filter(Boolean).join(', ');
          // Extra wedding facts, kept quiet under the headline (EZ1-I68).
          const extras = [
            b.offeringName,
            b.eventName,
            b.expectedGuests ? `${b.expectedGuests} guests` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          const isOpen = expanded === b.id;
          const isActive =
            b.status !== 'cancelled' && b.status !== 'completed' && b.status !== 'disputed';
          // A review can only be written once a vendor job is done, and only
          // once (EZ1-I30, EZ1-I114); a dispute only once escrow is in play.
          const canReview = b.status === 'completed' && b.providerType === 'vendor' && !b.myReview;
          const canDispute =
            canRaiseCase &&
            ['confirmed', 'in_progress', 'completed_pending_final_payment', 'completed'].includes(
              b.status,
            );
          const primaryLabel = isOpen ? 'Hide details' : PRIMARY_LABEL[b.status] ?? 'View details';
          return (
          <div
            key={b.id}
            className={`card space-y-4 ${highlight === b.id ? 'ring-2 ring-brand' : ''}`}
          >
            {/* Who and what, with the amount and date held to the right (EZ1-I167). */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-gray-900">
                  {b.providerName ?? `${b.providerType} ${b.providerId.slice(0, 8)}`}
                  {/* A booking the match-fixed partner placed, shared into this
                      account's wedding view (EZ1-I160). Service/offering already
                      read on the category/extras lines below (EZ1-I167). */}
                  {b.sharedFromPartner && (
                    <span className="ml-2 rounded-full bg-brand-light px-2 py-0.5 align-middle text-xs font-normal text-brand-dark">
                      Booked by {b.clientName || 'your partner'}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-gray-500">
                  <span className="capitalize">{category}</span>
                  {location && ` · ${location}`}
                </p>
                {extras && <p className="mt-0.5 text-xs text-gray-400">{extras}</p>}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-base font-semibold text-gray-900">
                  {priced ? `${b.currency} ${b.amount}` : 'Not yet priced'}
                </p>
                {b.eventDate && <p className="mt-0.5 text-xs text-gray-500">{b.eventDate}</p>}
              </div>
            </div>

            {/* Current status in plain English, with the payment status beside it. */}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                  {BOOKING_STATUS_LABEL[b.status] ?? b.status}
                </span>
                {b.paymentStatus && (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand-strong">
                    {b.paymentStatus.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              {STATUS_HINT[b.status] && (
                <p className="mt-1 text-xs text-gray-500">{STATUS_HINT[b.status]}</p>
              )}
            </div>

            {/* A glanceable progress bar while the booking is still moving (EZ1-I12, EZ1-I167). */}
            {isActive && STAGE_INDEX[b.status] !== undefined && (
              <div className="overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <BookingProgress status={b.status} />
              </div>
            )}

            {/* One clear primary action; cancel/dispute/review stay quieter (EZ1-I167). */}
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn" onClick={() => setExpanded(isOpen ? null : b.id)}>
                {primaryLabel}
              </button>
              {OPEN_STATUSES.includes(b.status) && (
                <button className="btn-outline" onClick={() => setCancelling(b.id)}>
                  Cancel
                </button>
              )}
              {canDispute && (
                <button
                  className="btn-outline text-red-600"
                  onClick={() => setDisputing(disputing === b.id ? null : b.id)}
                >
                  {disputing === b.id ? 'Never mind' : 'Raise an issue'}
                </button>
              )}
              {/* Once reviewed, the button is gone and the review is shown below (EZ1-I114). */}
              {canReview && (
                <button
                  className="btn-outline"
                  onClick={() => setReviewing(reviewing === b.id ? null : b.id)}
                >
                  {reviewing === b.id ? 'Never mind' : 'Write a review'}
                </button>
              )}
            </div>

            {b.myReview ? (
              <div className="mt-2 rounded-sm bg-surface-sunken p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-emerald-700">Review submitted</span>
                  <span className="flex items-center gap-0.5" aria-label={`${b.myReview.rating} out of 5`}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <span
                        key={star}
                        className={star <= b.myReview!.rating ? 'text-caution-fg' : 'text-gray-300'}
                        aria-hidden
                      >
                        ★
                      </span>
                    ))}
                  </span>
                </div>
                {b.myReview.comment && (
                  <p className="mt-1 text-sm text-gray-700">{b.myReview.comment}</p>
                )}
              </div>
            ) : (
              reviewing === b.id && <ReviewForm booking={b} onCancel={() => setReviewing(null)} />
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
                onDismiss={() => {
                  setCancelling(null);
                  setCancelReason('');
                }}
                onConfirm={async () => {
                  // The reason travels with the cancellation so the other side
                  // is told why, not just that it happened (EZ1-I77).
                  await run(() =>
                    api.put(`/bookings/${b.id}/cancel`, {
                      ...(cancelReason.trim() ? { reason: cancelReason.trim() } : {}),
                    }),
                  );
                  setCancelling(null);
                  setCancelReason('');
                }}
              >
                <label className="label">Reason (shared with the other side)</label>
                <textarea
                  className="input"
                  rows={2}
                  maxLength={500}
                  placeholder="Let them know why you are cancelling"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                />
              </ConfirmDialog>
            )}
          </div>
          );
        })}
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

  // The activity timeline (EZ1-I68): request, quotations, payments, delivery,
  // cancellation — one read over what already happened.
  const { data: timeline } = useQuery({
    queryKey: ['booking-history', booking.id],
    queryFn: async () =>
      (await api.get(`/bookings/${booking.id}/history`)).data as {
        at: string;
        label: string;
        detail: string | null;
      }[],
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

      {/* Everything that has happened to it, in order (EZ1-I68). */}
      {timeline && timeline.length > 0 && (
        <div>
          <h3 className="section-title text-sm">History</h3>
          <ol className="mt-1 space-y-1 border-l-2 border-gray-200 pl-3">
            {timeline.map((e, i) => (
              <li key={i} className="text-xs text-gray-600">
                <span className="text-gray-400">{new Date(e.at).toLocaleString()} · </span>
                <span className="font-medium capitalize text-gray-800">{e.label}</span>
                {e.detail ? ` — ${e.detail}` : ''}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Why it was cancelled and who by (EZ1-I77). */}
      {booking.status === 'cancelled' && (
        <div className="rounded-sm border border-red-200 bg-red-50 p-3 text-sm">
          <p className="font-medium text-red-900">Cancelled</p>
          <p className="mt-1 text-red-900">
            {booking.cancelledByName || booking.cancelledByRole
              ? `Cancelled by ${[booking.cancelledByName, booking.cancelledByRole && `(${booking.cancelledByRole})`]
                  .filter(Boolean)
                  .join(' ')}`
              : 'This booking was cancelled.'}
            {booking.cancelledAt
              ? ` on ${new Date(booking.cancelledAt).toLocaleString()}`
              : ''}
          </p>
          <p className="mt-1 text-red-900">
            Reason: {booking.cancellationReason || 'No reason was given.'}
          </p>
        </div>
      )}

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
