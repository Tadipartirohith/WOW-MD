import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { api, apiMessage } from '../lib/api';
import BookingChat from './BookingChat';
import BookingConsole from './BookingConsole';
import { BOOKING_STATUS_LABEL } from '../lib/permissions';
import { FieldSpec, formatAnswer } from './DynamicForm';

interface IncomingBooking {
  id: string;
  userId: string;
  amount: string;
  currency: string;
  status: string;
  eventDate: string | null;
  requirements?: string | null;
  expectedBudget?: string | null;
  vendorServiceId?: string | null;
  serviceAnswers?: Record<string, unknown>;
  quantity?: number | null;
}

/**
 * How a provider's incoming work sorts itself.
 *
 * One long list ordered by date is useless to somebody with forty live jobs:
 * what they need is "who is waiting on a price from me" separated from "who is
 * waiting on me to turn up". Each section is a question the provider has, in
 * the order the work actually moves.
 */


/**
 * Actions the seller side may take, by current status.
 *
 * A request carries no price: the provider quotes first, which is why
 * `requested` offers a quotation rather than an acceptance.
 */
const ACTIONS: Record<string, { label: string; path: string }[]> = {
  requested: [{ label: 'Decline', path: 'cancel' }],
  quotation_sent: [{ label: 'Withdraw', path: 'cancel' }],
  quotation_accepted: [
    { label: 'Accept the job', path: 'confirm' },
    { label: 'Decline', path: 'cancel' },
  ],
  payment_pending: [{ label: 'Cancel', path: 'cancel' }],
  pending: [
    { label: 'Accept the job', path: 'confirm' },
    { label: 'Cancel', path: 'cancel' },
  ],
  confirmed: [
    { label: 'Start work', path: 'start' },
    { label: 'Mark delivered', path: 'complete' },
    { label: 'Cancel', path: 'cancel' },
  ],
  in_progress: [{ label: 'Mark delivered', path: 'complete' }],
  completed: [],
  disputed: [],
  cancelled: [],
};

/** A provider can quote while the job is still unpriced or being re-priced. */
const QUOTABLE = ['requested', 'quotation_sent'];

/**
 * Everything coming in to a vendor or a planner.
 *
 * Lives here rather than on the business page because a listing and the work
 * against it are two different jobs: My Business is where the shop window is
 * edited, and this is where the day's work is answered.
 */
export default function ProviderBookings({ canQuote }: { canQuote: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [quoting, setQuoting] = useState<string | null>(null);


  const act = useMutation({
    mutationFn: async ({ id, path }: { id: string; path: string }) =>
      (await api.put(`/bookings/${id}/${path}`, path === 'cancel' ? {} : undefined)).data,
    onSuccess: () => {
      // Accepting a job spends a window, so the calendar has to be refetched
      // alongside the booking list or the vendor sees a stale capacity.
      qc.invalidateQueries({ queryKey: ['incoming-bookings'] });
      qc.invalidateQueries({ queryKey: ['availability-slots'] });
      qc.invalidateQueries({ queryKey: ['availability-summary'] });
      qc.invalidateQueries({ queryKey: ['availability-calendar'] });
      qc.invalidateQueries({ queryKey: ['availability-bucket'] });
      setError('');
    },
    onError: (err) => {
      const msg = (err as AxiosError<{ message?: string | string[] }>).response?.data?.message;
      setError(Array.isArray(msg) ? msg.join('. ') : msg || 'That action was rejected.');
    },
  });

  return (
    <div className="space-y-4">
      {error && <p className="alert-critical">{error}</p>}

      {/*
        One list with tabs, replacing six sections.

        The sections were a reasonable shape when a provider had four bookings
        and stop working at forty: the one being looked for is under a heading
        that has scrolled off, the counts only described what was on screen,
        and there was no way to search. The tabs count the whole queue, the
        filtering is client-side because a provider's queue is tens of rows and
        a round trip per keystroke would be slower and worse, and every row now
        carries what the decision is actually made on.
      */}
      <BookingConsole
        statusLabels={BOOKING_STATUS_LABEL}
        renderDetail={(b) => <ServiceAnswers booking={b as never} />}
        renderActions={(b) => (
          <>
            {(ACTIONS[b.status] ?? []).map((a) => (
              <button
                key={a.path}
                className={a.path === 'confirm' ? 'btn btn-sm' : 'btn-outline btn-sm'}
                disabled={act.isPending}
                onClick={() => act.mutate({ id: b.id, path: a.path })}
              >
                {a.label}
              </button>
            ))}
            {canQuote && QUOTABLE.includes(b.status) && (
              <button
                className="btn btn-sm"
                onClick={() => setQuoting(quoting === b.id ? null : b.id)}
              >
                {b.status === 'quotation_sent' ? 'Re-quote' : 'Send quotation'}
              </button>
            )}
            {canQuote && quoting === b.id && (
              <QuotationForm
                bookingId={b.id}
                onDone={() => {
                  setQuoting(null);
                  qc.invalidateQueries({ queryKey: ['incoming-bookings'] });
                  qc.invalidateQueries({ queryKey: ['incoming-counts'] });
                }}
              />
            )}
            {/*
              Messaging the client, on the job it is about. This is the
              "Message Client" the report asks for, and it has always been
              here — inside the booking, where a conversation about a wedding
              belongs, rather than in a general-purpose Chat menu.
            */}
            <div className="w-full">
              <BookingChat bookingId={b.id} />
            </div>
          </>
        )}
      />
    </div>
  );
}

/**
 * What the buyer answered on this service's own form.
 *
 * Fetched per service rather than stored on the booking, so a label an
 * administrator has since reworded reads correctly on an old request.
 */
function ServiceAnswers({ booking }: { booking: IncomingBooking }) {
  const answers = booking.serviceAnswers ?? {};
  const hasAnswers = Object.keys(answers).length > 0;

  const { data } = useQuery<{ bookingForm: FieldSpec[] }>({
    queryKey: ['service-booking-form', booking.vendorServiceId],
    queryFn: async () =>
      (await api.get(`/services/${booking.vendorServiceId}/booking-form`)).data,
    enabled: Boolean(booking.vendorServiceId) && hasAnswers,
    retry: false,
  });

  if (!hasAnswers) return null;
  const fields = data?.bookingForm ?? [];

  return (
    <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
      {fields
        .filter((f) => answers[f.key] !== undefined)
        .map((f) => (
          <div key={f.key} className="flex gap-2">
            <dt className="text-gray-500">{f.label}:</dt>
            <dd className="font-medium text-gray-800">{formatAnswer(f, answers[f.key])}</dd>
          </div>
        ))}
    </dl>
  );
}

function QuotationForm({ bookingId, onDone }: { bookingId: string; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [lines, setLines] = useState<{ description: string; amount: string }[]>([
    { description: '', amount: '' },
  ]);
  const [msg, setMsg] = useState('');

  const filled = lines.filter((l) => l.description.trim() && l.amount);
  const lineTotal = filled.reduce((t, l) => t + Number(l.amount || 0), 0);
  const mismatch = filled.length > 0 && Math.abs(lineTotal - Number(amount || 0)) > 0.001;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.post(`/bookings/${bookingId}/quotations`, {
        amount: Number(amount),
        notes: notes || undefined,
        terms: terms || undefined,
        validUntil: validUntil || undefined,
        lines: filled.length
          ? filled.map((l) => ({ description: l.description.trim(), amount: Number(l.amount) }))
          : undefined,
      });
      onDone();
    } catch (err) {
      setMsg(apiMessage(err, 'That quotation was rejected.'));
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 w-full space-y-3 rounded-sm bg-gray-50 p-3">
      {msg && <p className="alert-critical">{msg}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-gray-700">Total</span>
          <input
            className="input mt-1"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        <label className="text-sm">
          <span className="text-gray-700">Notes for the client</span>
          <input className="input mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="text-gray-700">Valid until</span>
          <input
            className="input mt-1"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
          <span className="mt-1 block text-xs text-gray-500">
            Left blank, the offer stands for 14 days.
          </span>
        </label>
      </div>

      {/* Kept apart from the notes on purpose. A note is a covering message;
          these are what the job is priced on, and what a dispute argues from. */}
      <label className="block text-sm">
        <span className="text-gray-700">Terms</span>
        <textarea
          className="input mt-1"
          rows={3}
          placeholder="Cancellation, overtime, travel, what happens if the guest count changes"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
        />
      </label>

      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-800">Breakdown (optional)</p>
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="What it covers"
              value={l.description}
              onChange={(e) =>
                setLines((ls) =>
                  ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                )
              }
            />
            <input
              className="input w-32"
              type="number"
              min={0}
              value={l.amount}
              onChange={(e) =>
                setLines((ls) => ls.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
              }
            />
          </div>
        ))}
        <button
          type="button"
          className="btn-outline"
          onClick={() => setLines((ls) => [...ls, { description: '', amount: '' }])}
        >
          Add a line
        </button>
        {mismatch && (
          <p className="text-sm text-red-600">
            The lines add up to {lineTotal}, which does not match the total.
          </p>
        )}
      </div>

      <button className="btn" disabled={!amount || mismatch}>
        Send to the client
      </button>
    </form>
  );
}
