import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { BOOKING_STATUS_LABEL, Permission, can } from '../lib/permissions';

interface Booking {
  id: string;
  userId: string;
  amount: string;
  currency: string;
  status: string;
  eventDate: string | null;
}

const CATEGORIES = ['venue', 'catering', 'photography', 'decor', 'makeup', 'entertainment'];

/**
 * Actions the seller side of a booking may take, by current status.
 *
 * A request carries no price: the vendor quotes first, which is why
 * `requested` offers a quotation rather than a confirmation.
 */
const PROVIDER_ACTIONS: Record<string, { label: string; path: string }[]> = {
  requested: [{ label: 'Cancel', path: 'cancel' }],
  quotation_sent: [{ label: 'Cancel', path: 'cancel' }],
  quotation_accepted: [{ label: 'Cancel', path: 'cancel' }],
  payment_pending: [{ label: 'Cancel', path: 'cancel' }],
  pending: [
    { label: 'Confirm', path: 'confirm' },
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

/** A vendor can quote while the job is still unpriced or being re-priced. */
const QUOTABLE = ['requested', 'quotation_sent'];

/**
 * The seller-side workspace, shared by vendors and wedding planners. Which
 * listing form renders is decided by the caller's capability, not by a role
 * string, so the two personas stay in one screen without special-casing.
 */
export default function ProviderConsole() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isVendor = can(permissions, Permission.VENDOR_LISTING_MANAGE);
  const [error, setError] = useState('');
  const [quoting, setQuoting] = useState<string | null>(null);

  const { data: incoming } = useQuery({
    queryKey: ['incoming-bookings'],
    queryFn: async () => (await api.get('/bookings/incoming')).data,
  });

  const { data: listing } = useQuery({
    queryKey: ['my-listing', isVendor],
    queryFn: async () =>
      isVendor ? (await api.get('/vendors/me')).data : (await api.get('/wedding-planners/me')).data,
    // A provider who has not created a listing yet gets a 404; that is a normal
    // first-run state, not an error worth retrying.
    retry: false,
  });

  const act = useMutation({
    mutationFn: async ({ id, path }: { id: string; path: string }) =>
      (await api.put(`/bookings/${id}/${path}`, path === 'cancel' ? {} : undefined)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incoming-bookings'] }),
    onError: (err) => {
      const msg = (err as AxiosError<{ message?: string | string[] }>).response?.data?.message;
      setError(Array.isArray(msg) ? msg.join('. ') : msg || 'That action was rejected.');
    },
  });

  const bookings: Booking[] = incoming?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">
          {isVendor ? 'Vendor console' : 'Planner console'}
        </h1>
        <p className="text-sm text-gray-500">
          Manage your listing and respond to bookings. Listings are reviewed by an administrator
          before they appear in search.
        </p>
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {isVendor ? <VendorListingForm existing={listing} /> : <PlannerListingForm existing={listing} />}

      {isVendor && listing?.[0]?.id && <AvailabilityPanel vendorId={listing[0].id} />}

      <div className="card space-y-3">
        <h2 className="font-semibold text-gray-900">Incoming bookings</h2>
        {bookings.length === 0 && (
          <p className="text-sm text-gray-400">No bookings against your listings yet.</p>
        )}
        <div className="divide-y">
          {bookings.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">
                  {b.currency} {b.amount}
                </p>
                <p className="text-sm text-gray-500">
                  Client {b.userId.slice(0, 8)}…
                  {b.eventDate ? ` · event ${b.eventDate}` : ''} · status{' '}
                  <span className="font-medium">
                    {BOOKING_STATUS_LABEL[b.status] ?? b.status}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(PROVIDER_ACTIONS[b.status] ?? []).map((a) => (
                  <button
                    key={a.path}
                    className="btn-outline"
                    onClick={() => act.mutate({ id: b.id, path: a.path })}
                  >
                    {a.label}
                  </button>
                ))}
                {isVendor && QUOTABLE.includes(b.status) && (
                  <button
                    className="btn"
                    onClick={() => setQuoting(quoting === b.id ? null : b.id)}
                  >
                    {b.status === 'quotation_sent' ? 'Re-quote' : 'Send quotation'}
                  </button>
                )}
              </div>
              {isVendor && quoting === b.id && (
                <QuotationForm
                  bookingId={b.id}
                  onDone={() => {
                    setQuoting(null);
                    qc.invalidateQueries({ queryKey: ['incoming-bookings'] });
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function VendorListingForm({ existing }: { existing?: { id: string; name: string }[] }) {
  const qc = useQueryClient();
  const current = existing?.[0];
  const [form, setForm] = useState({
    name: '',
    category: 'venue',
    city: '',
    description: '',
    gstNumber: '',
    panNumber: '',
    registrationNumber: '',
    registeredAddress: '',
    contactPhone: '',
  });
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (current) setForm((f) => ({ ...f, ...current }));
  }, [current]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      // Empty strings are not the same as "not provided": sending one would
      // fail the format checks on GST and PAN, so they are dropped instead.
      const payload = Object.fromEntries(
        Object.entries(form).filter(([, v]) => v !== '' && v !== null),
      );
      if (current) await api.put(`/vendors/${current.id}`, payload);
      else await api.post('/vendors', payload);
      setMsg(
        'Saved. A verification officer visits the registered address before the listing goes live.',
      );
      qc.invalidateQueries({ queryKey: ['my-listing'] });
    } catch (err) {
      setMsg(apiMessage(err, 'Could not save the listing.'));
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={submit} className="card space-y-3">
      <h2 className="font-semibold text-gray-900">
        {current ? 'Edit your listing' : 'Create your listing'}
      </h2>
      {msg && <p className="rounded bg-brand-light p-2 text-sm text-brand-dark">{msg}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Business name</label>
          <input className="input" value={form.name} onChange={set('name')} required />
        </div>
        <div>
          <label className="label">Category</label>
          <select className="input" value={form.category} onChange={set('category')}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">City</label>
          <input className="input" value={form.city} onChange={set('city')} />
        </div>
      </div>
      <div>
        <label className="label">Description</label>
        <textarea
          className="input"
          rows={3}
          maxLength={2000}
          value={form.description}
          onChange={set('description')}
        />
      </div>

      <div className="border-t pt-3">
        <h3 className="font-medium text-gray-900">Registration</h3>
        <p className="mb-2 text-sm text-gray-600">
          You invoice real money against real events, so we hold the details that answer for that.
          The registered address is where the verification officer visits.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label">GST number</label>
            <input
              className="input"
              placeholder="29ABCDE1234F1Z5"
              value={form.gstNumber}
              onChange={set('gstNumber')}
            />
          </div>
          <div>
            <label className="label">PAN</label>
            <input
              className="input"
              placeholder="ABCDE1234F"
              value={form.panNumber}
              onChange={set('panNumber')}
            />
          </div>
          <div>
            <label className="label">Registration number</label>
            <input
              className="input"
              value={form.registrationNumber}
              onChange={set('registrationNumber')}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Registered address</label>
            <input
              className="input"
              value={form.registeredAddress}
              onChange={set('registeredAddress')}
            />
          </div>
          <div>
            <label className="label">Contact number</label>
            <input className="input" value={form.contactPhone} onChange={set('contactPhone')} />
          </div>
        </div>
      </div>

      <button className="btn">{current ? 'Save changes' : 'Create listing'}</button>
    </form>
  );
}

function PlannerListingForm({ existing }: { existing?: { agencyName: string } }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ agencyName: '', city: '', bio: '', yearsExperience: 0 });
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (existing) setForm((f) => ({ ...f, ...existing }));
  }, [existing]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.put('/wedding-planners/me', {
        ...form,
        yearsExperience: Number(form.yearsExperience) || 0,
      });
      setMsg('Saved. An administrator will review it before it appears in search.');
      qc.invalidateQueries({ queryKey: ['my-listing'] });
    } catch {
      setMsg('Could not save the listing.');
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <form onSubmit={submit} className="card space-y-3">
      <h2 className="font-semibold text-gray-900">Your planning agency</h2>
      {msg && <p className="rounded bg-brand-light p-2 text-sm text-brand-dark">{msg}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Agency name</label>
          <input className="input" value={form.agencyName} onChange={set('agencyName')} required />
        </div>
        <div>
          <label className="label">Base city</label>
          <input className="input" value={form.city} onChange={set('city')} />
        </div>
        <div>
          <label className="label">Years of experience</label>
          <input
            className="input"
            type="number"
            min={0}
            max={80}
            value={form.yearsExperience}
            onChange={set('yearsExperience')}
          />
        </div>
      </div>
      <div>
        <label className="label">About your agency</label>
        <textarea className="input" rows={3} maxLength={2000} value={form.bio} onChange={set('bio')} />
      </div>
      <button className="btn">Save listing</button>
    </form>
  );
}

/**
 * The price a vendor puts on a job.
 *
 * Line items are optional but they have to add up: a total that does not match
 * its own breakdown is the kind of thing that becomes a dispute three months
 * later, so the server refuses it and this form says so plainly.
 */
function QuotationForm({ bookingId, onDone }: { bookingId: string; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
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
    <form onSubmit={submit} className="mt-3 w-full space-y-3 rounded bg-gray-50 p-3">
      {msg && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{msg}</p>}
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
      </div>

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

/**
 * The vendor's calendar.
 *
 * Capacity zero blocks a date out. Everything else is capacity: most vendors
 * can take one wedding a day, a caterer with two teams can take two, and a date
 * with no entry at all is simply open — a vendor should not have to enumerate
 * their whole year before taking a single booking.
 */
function AvailabilityPanel({ vendorId }: { vendorId: string }) {
  const qc = useQueryClient();
  const [date, setDate] = useState('');
  const [capacity, setCapacity] = useState('1');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');

  const { data } = useQuery({
    queryKey: ['availability', vendorId],
    queryFn: async () =>
      (await api.get(`/vendors/${vendorId}/availability`)).data as {
        id: string;
        date: string;
        capacity: number;
        booked: number;
        note: string | null;
      }[],
    retry: false,
  });

  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      await api.put(`/vendors/${vendorId}/availability`, {
        date,
        capacity: Number(capacity),
        note: note || undefined,
      });
      setNote('');
      qc.invalidateQueries({ queryKey: ['availability', vendorId] });
    } catch (err) {
      setMsg(apiMessage(err, 'That date could not be saved.'));
    }
  }

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-semibold text-gray-900">Your calendar</h2>
        <p className="text-sm text-gray-600">
          A date you have not touched is open. Set capacity to zero to block one out — a booking on
          a full date is refused when the provider confirms, not after.
        </p>
      </div>

      {msg && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{msg}</p>}

      <form onSubmit={save} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="text-gray-700">Date</span>
          <input
            className="input mt-1"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <label className="text-sm">
          <span className="text-gray-700">Bookings that day</span>
          <input
            className="input mt-1 w-28"
            type="number"
            min={0}
            max={20}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </label>
        <label className="flex-1 text-sm">
          <span className="text-gray-700">Note</span>
          <input className="input mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn">Save</button>
      </form>

      <div className="divide-y">
        {(data ?? []).length === 0 && (
          <p className="text-sm text-gray-400">Nothing set. Every date is open.</p>
        )}
        {(data ?? []).map((d) => (
          <div key={d.id} className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">{d.date}</p>
              {d.note && <p className="text-xs text-gray-500">{d.note}</p>}
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                d.capacity === 0
                  ? 'bg-red-50 text-red-700'
                  : d.booked >= d.capacity
                    ? 'bg-amber-50 text-amber-800'
                    : 'bg-emerald-50 text-emerald-800'
              }`}
            >
              {d.capacity === 0
                ? 'Blocked'
                : d.booked >= d.capacity
                  ? 'Fully booked'
                  : `${d.capacity - d.booked} of ${d.capacity} free`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
