import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { BOOKING_STATUS_LABEL, MILESTONE_LABEL, Permission, can } from '../lib/permissions';

interface Booking {
  id: string;
  userId: string;
  bookedByUserId: string;
  providerType: 'vendor' | 'planner';
  providerId: string;
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
  status: string;
}

interface Milestone {
  milestone: 'advance' | 'second' | 'final';
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

  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

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

  if (!canBuy) {
    return (
      <div className="card">
        <h1 className="text-xl font-bold text-brand-dark">Bookings</h1>
        <p className="mt-2 text-sm text-gray-600">
          Your account sells services rather than buying them. Bookings made against your listings
          are in <strong>My Business</strong>.
        </p>
      </div>
    );
  }

  const bookings: Booking[] = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-brand-dark">Bookings &amp; Escrow</h1>
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

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {isLoading && <p className="text-gray-500">Loading...</p>}

      <div className="space-y-3">
        {!isLoading && bookings.length === 0 && (
          <p className="card text-sm text-gray-400">No bookings yet.</p>
        )}
        {bookings.map((b) => (
          <div key={b.id} className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium">
                  <span className="text-xs uppercase tracking-wide text-gray-400">
                    {b.providerType}
                  </span>{' '}
                  {b.providerId.slice(0, 8)}…
                </p>
                <p className="text-sm text-gray-500">
                  {b.currency} {b.amount}
                  {b.eventDate ? ` · event ${b.eventDate}` : ''}
                  {b.bookedByUserId !== b.userId && ' · booked by your agent'}
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
                  <button className="btn-outline" onClick={() => run(() => api.put(`/bookings/${b.id}/cancel`, {}))}>
                    Cancel
                  </button>
                )}
                {canRaiseCase && ['confirmed', 'in_progress', 'completed'].includes(b.status) && (
                  <button
                    className="btn-outline text-red-600"
                    onClick={() => {
                      const description = window.prompt(
                        'What went wrong? An officer investigates, and the money stays frozen until they decide.',
                      );
                      if (description && description.trim().length >= 10) {
                        void run(() =>
                          api.post('/verification/cases', {
                            subjectType: 'booking',
                            subjectId: b.id,
                            title: 'Booking dispute',
                            description: description.trim(),
                          }),
                        );
                      }
                    }}
                  >
                    Raise an issue
                  </button>
                )}
              </div>
            </div>

            {expanded === b.id && (
              <BookingDetail booking={b} canPay={canPay} onRun={run} />
            )}
          </div>
        ))}
      </div>
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

  const live = (quotations ?? []).find((q) => q.status === 'sent');
  const paid = new Set(
    (milestones?.milestones ?? [])
      .filter((m) => m.status && m.status !== 'refunded' && m.status !== 'failed')
      .map((m) => m.milestone),
  );
  const nextDue = (milestones?.milestones ?? []).find((m) => !paid.has(m.milestone));

  return (
    <div className="space-y-4 border-t pt-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Quotations</h3>
        {(quotations ?? []).length === 0 && (
          <p className="text-sm text-gray-500">
            The provider has not priced this yet. They will send a quotation.
          </p>
        )}
        {(quotations ?? []).map((q) => (
          <div key={q.id} className="mt-2 rounded bg-gray-50 p-3">
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

      {milestones && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Instalments</h3>
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
                ) : canPay && nextDue?.milestone === m.milestone ? (
                  <button
                    className="btn"
                    onClick={() =>
                      onRun(() =>
                        api.put(`/bookings/${booking.id}/pay`, { milestone: m.milestone }),
                      )
                    }
                  >
                    Pay
                  </button>
                ) : (
                  <span className="text-xs text-gray-400">Not due yet</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
