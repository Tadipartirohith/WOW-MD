import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { Link } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { formatDate } from '../lib/dates';
import BookingChat from './BookingChat';
import BookingConsole from './BookingConsole';
import { BOOKING_STATUS_LABEL, Permission, can } from '../lib/permissions';
import { useAuth } from '../store/auth';
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
  // A planner reviews the couple's whole wedding before quoting (EZ1-I162); a
  // vendor quotes on their one service and does not see the brief.
  const isPlanner = can(useAuth((s) => s.user?.permissions ?? []), Permission.PLANNER_LISTING_MANAGE);


  const act = useMutation({
    mutationFn: async ({
      id,
      path,
      body,
    }: {
      id: string;
      path: string;
      // Marking a delivery carries what was delivered (EZ1-I228); every other
      // action still posts nothing.
      body?: Record<string, unknown>;
    }) => (await api.put(`/bookings/${id}/${path}`, body ?? (path === 'cancel' ? {} : undefined))).data,
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
        renderDetail={(b) => (
          <>
            <ServiceAnswers booking={b as never} />
            {isPlanner && <WeddingBrief bookingId={b.id} />}
            <VendorAddOns bookingId={b.id} />
          </>
        )}
        renderActions={(b) => (
          <>
            {(ACTIONS[b.status] ?? []).map((a) => (
              <button
                key={a.path}
                className={a.path === 'confirm' ? 'btn btn-sm' : 'btn-outline btn-sm'}
                disabled={act.isPending}
                onClick={() => {
                  /*
                    Marking a delivery asks what was delivered (EZ1-I228).

                    Optional -- a caterer has nothing to show, a photographer
                    has a gallery link -- but when it is given it stays on the
                    booking, which is what the customer reads before confirming
                    and what an administrator settling a later dispute needs.
                    Cancelling the prompt cancels the action rather than
                    marking it delivered with no note.
                  */
                  if (a.path === 'complete') {
                    const notes = window.prompt(
                      'What was delivered? The customer sees this when they confirm. Leave blank to skip.',
                    );
                    if (notes === null) return;
                    act.mutate({
                      id: b.id,
                      path: a.path,
                      body: notes.trim() ? { notes: notes.trim() } : {},
                    });
                    return;
                  }
                  act.mutate({ id: b.id, path: a.path });
                }}
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

interface BriefVendor {
  name: string;
  category: string | null;
  service: string | null;
  status: string;
  eventDate?: string | null;
}

interface RequestBrief {
  /** `userId` is the couple the brief belongs to, for the link into Events. */
  client: { name: string; userId?: string | null };
  request: {
    requirements: string | null;
    expectedBudget: string | null;
    currency: string;
    notes: string | null;
    forEvent: string | null;
  };
  wedding: {
    weddingDate: string | null;
    guestCount: number | null;
    venues: string[];
    cities: string[];
    functions: number;
  };
  requirement: {
    vendorsArranged: number;
    sourced: { category: string; count: number; services: string[] }[];
    toSource: string[];
    structuredNeed: boolean;
  };
  events: {
    id: string;
    name: string;
    date: string | null;
    startTime: string | null;
    endTime: string | null;
    venue: string | null;
    city: string | null;
    expectedGuests: number | null;
    budget: string | null;
    category: string | null;
    theme: string | null;
    specialRequirements: string | null;
    description: string | null;
    arrangedVendors: BriefVendor[];
  }[];
  otherVendors: BriefVendor[];
}

/**
 * The couple's whole wedding, for the planner deciding what to quote (EZ1-I162).
 *
 * The request row alone says who and when; a planner pricing the job needs the
 * shape of the wedding — every function, its guests and venue, and which
 * vendors the couple has already arranged against which day, so they can tell
 * what is left to source. Fetched only when opened, because a planner's queue
 * is many rows and the brief is a screen's worth each.
 */
function WeddingBrief({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isPending } = useQuery<RequestBrief>({
    queryKey: ['request-brief', bookingId],
    queryFn: async () => (await api.get(`/planner/requests/${bookingId}/brief`)).data,
    enabled: open,
    retry: false,
  });

  const money = (v: string | number, ccy = 'INR') =>
    `${ccy} ${Number(v || 0).toLocaleString('en-IN')}`;
  const vendorLine = (v: BriefVendor) =>
    [v.name, v.service, v.category].filter(Boolean).join(' · ');

  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-xs font-medium text-brand-strong underline underline-offset-2"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide wedding brief' : 'View wedding brief'}
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-sm bg-surface-sunken p-3 text-xs text-gray-700">
          {isPending && <p className="text-gray-500">Loading the brief…</p>}
          {/*
            Through to the Events module, which owns this detail.

            The brief is a read-only assembly of the couple's events; anything
            that needs changing is changed there, on the one record both sides
            share (EZ1-I195, EZ1-I196).
          */}
          {data?.client?.userId && (
            <Link
              className="inline-block text-xs font-medium text-brand-strong underline underline-offset-2"
              to={`/events?host=${data.client.userId}`}
            >
              Open these days in Events
            </Link>
          )}
          {data && (
            <>
              <dl className="flex flex-wrap gap-x-4 gap-y-1">
                <div className="flex gap-1.5">
                  <dt className="text-gray-400">Wedding</dt>
                  <dd className="font-medium">
                    {data.wedding.weddingDate ? formatDate(data.wedding.weddingDate) : 'Not set'}
                  </dd>
                </div>
                {data.wedding.guestCount ? (
                  <div className="flex gap-1.5">
                    <dt className="text-gray-400">Guests</dt>
                    <dd className="font-medium">up to {data.wedding.guestCount}</dd>
                  </div>
                ) : null}
                {data.wedding.venues.length > 0 && (
                  <div className="flex gap-1.5">
                    <dt className="text-gray-400">Venues</dt>
                    <dd className="font-medium">
                      {[...data.wedding.venues, ...data.wedding.cities].slice(0, 4).join(', ')}
                    </dd>
                  </div>
                )}
                {data.request.expectedBudget && Number(data.request.expectedBudget) > 0 && (
                  <div className="flex gap-1.5">
                    <dt className="text-gray-400">Their budget</dt>
                    <dd className="font-mono font-medium">
                      {money(data.request.expectedBudget, data.request.currency)}
                    </dd>
                  </div>
                )}
              </dl>

              {data.request.requirements && (
                <p className="rounded-sm bg-surface p-2">
                  <span className="text-gray-400">What they asked for: </span>
                  {data.request.requirements}
                </p>
              )}

              {/*
                The vendor requirement at a glance (EZ1-I216): which categories the
                couple has already secured, and which core categories are still
                open — the part the planner is being asked to quote for. Derived
                from the couple's bookings; see the note below on structured
                capture.
              */}
              <div className="rounded-sm bg-surface p-2">
                <p className="font-medium text-gray-800">
                  Vendor requirement
                  <span className="ml-1 font-normal text-gray-500">
                    · {data.requirement.vendorsArranged}{' '}
                    {data.requirement.vendorsArranged === 1 ? 'vendor' : 'vendors'} arranged so far
                  </span>
                </p>
                {data.requirement.sourced.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {data.requirement.sourced.map((s) => (
                      <li key={s.category}>
                        <span className="font-medium capitalize text-gray-700">{s.category}</span>
                        <span className="text-gray-400"> ×{s.count}</span>
                        {s.services.length > 0 && (
                          <span className="text-gray-500"> — {s.services.join(', ')}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {data.requirement.toSource.length > 0 ? (
                  <p className="mt-1 text-gray-600">
                    <span className="text-gray-400">Still to source: </span>
                    <span className="capitalize">{data.requirement.toSource.join(', ')}</span>
                  </p>
                ) : (
                  <p className="mt-1 text-gray-400">Every core category has a vendor against it.</p>
                )}
                {!data.requirement.structuredNeed && (
                  <p className="mt-1 text-[0.6875rem] text-gray-400">
                    Derived from the couple's events and bookings — the request does not yet capture
                    required categories or a vendor count directly.
                  </p>
                )}
              </div>

              {data.events.length === 0 ? (
                <p className="text-gray-500">The couple has not added their functions yet.</p>
              ) : (
                <div className="space-y-2">
                  <p className="font-medium text-gray-800">
                    Functions ({data.wedding.functions})
                  </p>
                  {data.events.map((e) => (
                    <div key={e.id} className="rounded-sm bg-surface p-2">
                      <p className="font-medium text-gray-900">
                        {e.name}
                        <span className="ml-1 font-normal text-gray-500">
                          {e.date ? formatDate(e.date) : 'Date not set'}
                          {e.startTime ? ` · ${e.startTime.slice(0, 5)}` : ''}
                          {e.endTime ? `–${e.endTime.slice(0, 5)}` : ''}
                        </span>
                      </p>
                      <p className="text-gray-500">
                        {[e.venue, e.city].filter(Boolean).join(', ') || 'Venue not set'}
                        {e.expectedGuests ? ` · ${e.expectedGuests} guests` : ''}
                        {e.budget && Number(e.budget) > 0 ? ` · ${money(e.budget)}` : ''}
                      </p>
                      {(e.theme || e.specialRequirements || e.description) && (
                        <p className="mt-1 text-gray-600">
                          {[e.theme, e.specialRequirements, e.description].filter(Boolean).join(' — ')}
                        </p>
                      )}
                      {e.arrangedVendors.length > 0 ? (
                        <p className="mt-1 text-gray-600">
                          <span className="text-gray-400">Already booked: </span>
                          {e.arrangedVendors.map(vendorLine).join('; ')}
                        </p>
                      ) : (
                        <p className="mt-1 text-gray-400">No vendors arranged for this day yet.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {data.otherVendors.length > 0 && (
                <p className="text-gray-600">
                  <span className="text-gray-400">Other vendors already booked: </span>
                  {data.otherVendors.map(vendorLine).join('; ')}
                </p>
              )}

              {/* Close the loop from the brief to the action: the Send quotation
                  button sits on this same card, in the row below (EZ1-I216). */}
              <p className="border-t border-gray-200 pt-2 text-gray-500">
                Ready to price this? Use <span className="font-medium text-gray-700">Send quotation</span>{' '}
                below to quote against these requirements
                {data.requirement.toSource.length > 0
                  ? ', including the categories still to source.'
                  : '.'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface BookingAddon {
  id: string;
  title: string;
  description: string | null;
  quantity: number;
  proposedPrice: string | null;
  vendorPrice: string | null;
  currency: string;
  note: string | null;
  status: 'requested' | 'accepted' | 'rejected' | 'requoted';
  responseNote: string | null;
  createdAt: string;
}

const ADDON_STATUS_LABEL: Record<BookingAddon['status'], string> = {
  requested: 'Awaiting your response',
  requoted: 'Requoted → awaiting the client',
  accepted: 'Agreed',
  rejected: 'Declined',
};

/**
 * Add-on requests the client raised on this booking (EZ1-I215).
 *
 * The seller side of the mini-quotation on a confirmed booking: the vendor sees
 * each extra the client asked for and accepts it, rejects it, or requotes with
 * their own price for the client to accept. Only the requests still awaiting the
 * vendor carry the controls.
 */
function VendorAddOns({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const [requoting, setRequoting] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');

  const { data: addons } = useQuery({
    queryKey: ['incoming-addons', bookingId],
    queryFn: async () => (await api.get(`/bookings/${bookingId}/addons`)).data as BookingAddon[],
    retry: false,
  });

  async function run(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['incoming-addons', bookingId] });
      setRequoting(null);
      setPrice('');
    } catch (err) {
      setError(apiMessage(err, 'That action was rejected.'));
    }
  }

  if ((addons ?? []).length === 0) return null;

  return (
    <div className="mt-3 rounded-sm bg-surface-sunken p-3">
      <p className="text-sm font-semibold text-gray-800">Add-on requests</p>
      {error && <p className="mt-1 alert-critical">{error}</p>}
      <div className="mt-2 space-y-2">
        {(addons ?? []).map((a) => (
          <div key={a.id} className="rounded-sm bg-surface p-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-gray-900">
                {a.title}
                {a.quantity > 1 && <span className="text-gray-500"> × {a.quantity}</span>}
              </p>
              <span className="text-xs capitalize text-gray-500">{ADDON_STATUS_LABEL[a.status]}</span>
            </div>
            {a.description && <p className="mt-1 text-gray-600">{a.description}</p>}
            {a.note && <p className="mt-1 text-xs text-gray-500">Client note: {a.note}</p>}
            <div className="mt-1 text-gray-700">
              {a.proposedPrice != null && (
                <span>
                  Client proposed: {a.currency} {a.proposedPrice}
                </span>
              )}
              {a.vendorPrice != null && (
                <span className="ml-2 font-medium text-gray-900">
                  Your price: {a.currency} {a.vendorPrice}
                </span>
              )}
            </div>

            {a.status === 'requested' && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  className="btn btn-sm"
                  onClick={() => run(() => api.put(`/bookings/addons/${a.id}/accept`, {}))}
                >
                  Accept
                </button>
                <button
                  className="btn-outline btn-sm"
                  onClick={() => run(() => api.put(`/bookings/addons/${a.id}/reject`, {}))}
                >
                  Reject
                </button>
                <button
                  className="btn-outline btn-sm"
                  onClick={() => {
                    setRequoting(requoting === a.id ? null : a.id);
                    setPrice(a.proposedPrice ?? '');
                  }}
                >
                  Requote
                </button>
                {requoting === a.id && (
                  <div className="flex items-center gap-2">
                    <input
                      className="input w-32"
                      type="number"
                      min={0}
                      placeholder="Your price"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                    <button
                      className="btn btn-sm"
                      disabled={!price}
                      onClick={() =>
                        run(() =>
                          api.put(`/bookings/addons/${a.id}/requote`, {
                            vendorPrice: Number(price),
                          }),
                        )
                      }
                    >
                      Send price
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function QuotationForm({ bookingId, onDone }: { bookingId: string; onDone: () => void }) {
  const isPlanner = can(useAuth((s) => s.user?.permissions ?? []), Permission.PLANNER_LISTING_MANAGE);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [validUntil, setValidUntil] = useState('');
  // A planner quotes with or without arranging vendors (EZ1-I143); the choice
  // is recorded so the client sees which offer this is.
  const [vendorsIncluded, setVendorsIncluded] = useState(false);
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
        vendorsIncluded: isPlanner ? vendorsIncluded : undefined,
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
      {isPlanner && (
        <label className="flex items-start gap-2 rounded-sm bg-white p-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={vendorsIncluded}
            onChange={(e) => setVendorsIncluded(e.target.checked)}
          />
          <span className="text-gray-700">
            This quotation includes arranging the couple's vendors. Add the vendor/service costs
            and your coordination fee to the total and itemise them below; leave it unticked to
            quote your own services only (EZ1-I143).
          </span>
        </label>
      )}
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
