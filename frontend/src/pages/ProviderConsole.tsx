import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AxiosError } from 'axios';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import {
  BOOKING_STATUS_LABEL,
  GSTIN_PATTERN,
  PAN_PATTERN,
  Permission,
  VENDOR_CATEGORIES,
  can,
} from '../lib/permissions';

interface Booking {
  id: string;
  userId: string;
  amount: string;
  currency: string;
  status: string;
  eventDate: string | null;
  requirements?: string | null;
  expectedBudget?: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  venue: 'Venue',
  catering: 'Catering',
  photography: 'Photography',
  decor: 'Decor',
  makeup: 'Makeup',
  entertainment: 'Entertainment',
  other: 'Other',
};

/**
 * How a vendor's own bookings sort themselves.
 *
 * One long list ordered by date is useless to somebody with forty live jobs:
 * what they need is "who is waiting on a price from me" separated from "who is
 * waiting on me to turn up". Each section is a question the vendor has, in the
 * order the work actually moves.
 */
const BOOKING_SECTIONS: { title: string; blurb: string; statuses: string[] }[] = [
  {
    title: 'New requests',
    blurb: 'Waiting on a price from you',
    statuses: ['requested'],
  },
  {
    title: 'Quoted',
    blurb: 'Waiting on the client to accept',
    statuses: ['quotation_sent'],
  },
  {
    title: 'Awaiting the advance',
    blurb: 'Priced and agreed; the job is not secured until the money is in escrow',
    statuses: ['quotation_accepted', 'payment_pending'],
  },
  {
    title: 'To confirm',
    blurb: 'The advance is held — say yes and the date is yours',
    statuses: ['pending'],
  },
  {
    title: 'Upcoming',
    blurb: 'Confirmed and not yet started',
    statuses: ['confirmed'],
  },
  {
    title: 'In progress',
    blurb: 'Under way',
    statuses: ['in_progress'],
  },
  {
    title: 'Closed',
    blurb: 'Delivered, cancelled or under investigation',
    statuses: ['completed_pending_final_payment', 'completed', 'cancelled', 'disputed'],
  },
];

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

      {isVendor && listing?.[0]?.id && (
        <p className="card text-sm text-gray-600">
          Your calendar lives under{' '}
          <Link className="text-brand underline" to="/availability">
            Availability
          </Link>{' '}
          — publish the windows you can take work in, and clients can only ask for those.
        </p>
      )}

      <div className="space-y-4">
        <h2 className="font-semibold text-gray-900">Bookings</h2>
        {bookings.length === 0 && (
          <p className="card text-sm text-gray-400">No bookings against your listings yet.</p>
        )}
        {BOOKING_SECTIONS.map((section) => {
          const rows = bookings.filter((b) => section.statuses.includes(b.status));
          if (rows.length === 0) return null;
          return (
            <div key={section.title} className="card space-y-2">
              <div>
                <h3 className="font-medium text-gray-900">
                  {section.title}{' '}
                  <span className="text-sm font-normal text-gray-400">({rows.length})</span>
                </h3>
                <p className="text-sm text-gray-600">{section.blurb}</p>
              </div>
              <div className="divide-y">
          {rows.map((b) => (
            <div key={b.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">
                  {Number(b.amount) > 0
                    ? `${b.currency} ${b.amount}`
                    : b.expectedBudget
                      ? `Not priced — their budget is ${b.currency} ${b.expectedBudget}`
                      : 'Not priced yet'}
                </p>
                <p className="text-sm text-gray-500">
                  {b.eventDate ? `${b.eventDate} · ` : ''}
                  {BOOKING_STATUS_LABEL[b.status] ?? b.status}
                </p>
                {b.requirements && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
                    {b.requirements}
                  </p>
                )}
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
          );
        })}
      </div>
    </div>
  );
}

interface VendorListing {
  id: string;
  name: string;
  category: string;
  otherCategory: string | null;
  city: string;
  description: string;
  gstNumber: string | null;
  panNumber: string | null;
  registrationNumber: string | null;
  registeredAddress: string | null;
  contactPhone: string | null;
  pricing: { startingAt?: number; unit?: string; notes?: string };
  portfolio: string[];
  isApproved: boolean;
}

const emptyListing = {
  name: '',
  category: 'venue',
  otherCategory: '',
  city: '',
  description: '',
  gstNumber: '',
  panNumber: '',
  registrationNumber: '',
  registeredAddress: '',
  contactPhone: '',
  startingAt: '',
  unit: '',
  pricingNotes: '',
};

/**
 * The business record.
 *
 * Saved details are shown back as a record, not as a form pre-filled with them:
 * a vendor opening this page wants to check what the platform is telling
 * clients about them, and a page that only ever offers an edit form makes that
 * check look like an invitation to change something.
 */
function VendorListingForm({ existing }: { existing?: VendorListing[] }) {
  const qc = useQueryClient();
  const current = existing?.[0];
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyListing);
  const [portfolio, setPortfolio] = useState<string[]>([]);
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!current) {
      setEditing(true);
      return;
    }
    setForm({
      name: current.name ?? '',
      category: current.category ?? 'venue',
      otherCategory: current.otherCategory ?? '',
      city: current.city ?? '',
      description: current.description ?? '',
      gstNumber: current.gstNumber ?? '',
      panNumber: current.panNumber ?? '',
      registrationNumber: current.registrationNumber ?? '',
      registeredAddress: current.registeredAddress ?? '',
      contactPhone: current.contactPhone ?? '',
      startingAt: current.pricing?.startingAt ? String(current.pricing.startingAt) : '',
      unit: current.pricing?.unit ?? '',
      pricingNotes: current.pricing?.notes ?? '',
    });
    setPortfolio(current.portfolio ?? []);
  }, [current]);

  /** Field-level, and specific about what is wrong rather than "invalid". */
  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'Your business needs a name';
    if (form.category === 'other' && !form.otherCategory.trim()) {
      errors.otherCategory = 'Say what you do, so clients can find you';
    }
    if (form.gstNumber && !GSTIN_PATTERN.test(form.gstNumber.toUpperCase())) {
      errors.gstNumber = 'A GSTIN is 15 characters, like 29ABCDE1234F1Z5';
    }
    if (form.panNumber && !PAN_PATTERN.test(form.panNumber.toUpperCase())) {
      errors.panNumber = 'A PAN is 10 characters, like ABCDE1234F';
    }
    if (form.contactPhone && !/^(\+91)?[6-9]\d{9}$/.test(form.contactPhone.replace(/\s|-/g, ''))) {
      errors.contactPhone = 'Enter a 10-digit Indian mobile number';
    }
    return errors;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        category: form.category,
        // Portfolio is deliberately always sent, including empty: clearing the
        // last photo has to be able to reach the server.
        portfolio,
      };
      if (form.category === 'other') payload.otherCategory = form.otherCategory.trim();
      for (const key of [
        'city',
        'description',
        'gstNumber',
        'panNumber',
        'registrationNumber',
        'registeredAddress',
        'contactPhone',
      ] as const) {
        // An empty string is not "not provided" — sending one fails the format
        // checks on GST and PAN, so blanks are dropped instead.
        if (form[key]) payload[key] = form[key];
      }
      if (form.startingAt || form.unit || form.pricingNotes) {
        payload.pricing = {
          ...(form.startingAt ? { startingAt: Number(form.startingAt) } : {}),
          ...(form.unit ? { unit: form.unit } : {}),
          ...(form.pricingNotes ? { notes: form.pricingNotes } : {}),
        };
      }

      if (current) await api.put(`/vendors/${current.id}`, payload);
      else await api.post('/vendors', payload);

      setMsg(
        'Saved. A verification officer visits the registered address before the listing goes live.',
      );
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['my-listing'] });
    } catch (err) {
      setMsg(apiMessage(err, 'Could not save the listing.'));
    }
  }

  const set = (k: keyof typeof emptyListing) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  if (current && !editing) {
    return (
      <div className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold text-gray-900">{current.name}</h2>
            <p className="text-sm text-gray-600">
              {current.category === 'other'
                ? (current.otherCategory ?? 'Other')
                : (CATEGORY_LABEL[current.category] ?? current.category)}
              {current.city ? ` \u00b7 ${current.city}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-1 text-xs ${
                current.isApproved
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'bg-amber-50 text-amber-800'
              }`}
            >
              {current.isApproved ? 'Live in search' : 'Awaiting verification'}
            </span>
            <button className="btn-outline" onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
        </div>

        {msg && <p className="rounded bg-brand-light p-2 text-sm text-brand-dark">{msg}</p>}
        {current.description && <p className="text-sm text-gray-700">{current.description}</p>}

        <dl className="grid gap-x-6 gap-y-2 border-t pt-3 text-sm sm:grid-cols-2">
          <Detail label="Starting price">
            {current.pricing?.startingAt
              ? `\u20b9${Number(current.pricing.startingAt).toLocaleString('en-IN')}${
                  current.pricing.unit ? ` per ${current.pricing.unit}` : ''
                }`
              : 'Not published'}
          </Detail>
          <Detail label="GST number">{current.gstNumber ?? 'Not provided'}</Detail>
          <Detail label="PAN">{current.panNumber ?? 'Not provided'}</Detail>
          <Detail label="Registration number">
            {current.registrationNumber ?? 'Not provided'}
          </Detail>
          <Detail label="Registered address">
            {current.registeredAddress ?? 'Not provided'}
          </Detail>
          <Detail label="Contact number">{current.contactPhone ?? 'Not provided'}</Detail>
        </dl>

        {current.portfolio?.length > 0 && (
          <div className="border-t pt-3">
            <p className="mb-2 text-sm font-medium text-gray-900">Portfolio</p>
            <div className="flex flex-wrap gap-2">
              {current.portfolio.map((url) => (
                <img
                  key={url}
                  src={url}
                  alt=""
                  className="h-20 w-28 rounded object-cover"
                  loading="lazy"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-3" noValidate>
      <h2 className="font-semibold text-gray-900">
        {current ? 'Edit your listing' : 'Create your listing'}
      </h2>
      {msg && <p className="rounded bg-brand-light p-2 text-sm text-brand-dark">{msg}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Business name" error={fieldErrors.name}>
          <input className="input" value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Category">
          <select className="input" value={form.category} onChange={set('category')}>
            {VENDOR_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        {form.category === 'other' && (
          <Field label="Specify category" error={fieldErrors.otherCategory}>
            <input
              className="input"
              placeholder="Mehendi artist"
              value={form.otherCategory}
              onChange={set('otherCategory')}
            />
          </Field>
        )}
        <Field label="City">
          <input className="input" value={form.city} onChange={set('city')} />
        </Field>
      </div>

      <Field label="Description">
        <textarea
          className="input"
          rows={3}
          maxLength={2000}
          value={form.description}
          onChange={set('description')}
        />
      </Field>

      <div className="border-t pt-3">
        <h3 className="font-medium text-gray-900">Pricing</h3>
        <p className="mb-2 text-sm text-gray-600">
          A starting price, not a quote. It is what a client uses to decide whether to ask you at
          all — the real number comes from the quotation.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Starting at (₹)">
            <input
              className="input"
              type="number"
              min={0}
              value={form.startingAt}
              onChange={set('startingAt')}
            />
          </Field>
          <Field label="Per">
            <input
              className="input"
              placeholder="plate, day, event"
              value={form.unit}
              onChange={set('unit')}
            />
          </Field>
          <Field label="Pricing notes">
            <input className="input" value={form.pricingNotes} onChange={set('pricingNotes')} />
          </Field>
        </div>
      </div>

      <div className="border-t pt-3">
        <h3 className="font-medium text-gray-900">Portfolio</h3>
        <p className="mb-2 text-sm text-gray-600">
          Optional — a listing saves perfectly well without photographs, though very few clients
          book from one that has none.
        </p>
        {portfolio.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {portfolio.map((url) => (
              <div key={url} className="relative">
                <img src={url} alt="" className="h-20 w-28 rounded object-cover" loading="lazy" />
                <button
                  type="button"
                  className="absolute right-1 top-1 rounded bg-white/90 px-1.5 text-xs text-gray-700"
                  onClick={() => setPortfolio((p) => p.filter((u) => u !== url))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1"
            placeholder="https://…"
            value={portfolioUrl}
            onChange={(e) => setPortfolioUrl(e.target.value)}
          />
          <button
            type="button"
            className="btn-outline"
            disabled={!/^https?:\/\/\S+$/.test(portfolioUrl.trim())}
            onClick={() => {
              setPortfolio((p) => [...p, portfolioUrl.trim()]);
              setPortfolioUrl('');
            }}
          >
            Add photo
          </button>
        </div>
      </div>

      <div className="border-t pt-3">
        <h3 className="font-medium text-gray-900">Registration</h3>
        <p className="mb-2 text-sm text-gray-600">
          You invoice real money against real events, so we hold the details that answer for that.
          The registered address is where the verification officer visits.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="GST number" error={fieldErrors.gstNumber}>
            <input
              className="input"
              placeholder="29ABCDE1234F1Z5"
              maxLength={15}
              value={form.gstNumber}
              onChange={(e) => setForm((f) => ({ ...f, gstNumber: e.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="PAN" error={fieldErrors.panNumber}>
            <input
              className="input"
              placeholder="ABCDE1234F"
              maxLength={10}
              value={form.panNumber}
              onChange={(e) => setForm((f) => ({ ...f, panNumber: e.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="Registration number">
            <input
              className="input"
              value={form.registrationNumber}
              onChange={set('registrationNumber')}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Registered address">
              <input
                className="input"
                value={form.registeredAddress}
                onChange={set('registeredAddress')}
              />
            </Field>
          </div>
          <Field label="Contact number" error={fieldErrors.contactPhone}>
            <input className="input" value={form.contactPhone} onChange={set('contactPhone')} />
          </Field>
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn">{current ? 'Save changes' : 'Create listing'}</button>
        {current && (
          <button type="button" className="btn-outline" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-gray-800">{children}</dd>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
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
