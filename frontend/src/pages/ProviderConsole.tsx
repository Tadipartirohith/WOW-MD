import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { Permission, can } from '../lib/permissions';

interface Booking {
  id: string;
  userId: string;
  amount: string;
  currency: string;
  status: string;
  eventDate: string | null;
}

const CATEGORIES = ['venue', 'catering', 'photography', 'decor', 'makeup', 'entertainment'];

/** Actions the seller side of a booking may take, by current status. */
const PROVIDER_ACTIONS: Record<string, { label: string; path: string }[]> = {
  requested: [{ label: 'Cancel', path: 'cancel' }],
  pending: [
    { label: 'Confirm', path: 'confirm' },
    { label: 'Cancel', path: 'cancel' },
  ],
  confirmed: [
    { label: 'Mark completed', path: 'complete' },
    { label: 'Cancel', path: 'cancel' },
  ],
  completed: [],
  cancelled: [],
};

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
                  <span className="font-medium">{b.status}</span>
                </p>
              </div>
              <div className="flex gap-2">
                {(PROVIDER_ACTIONS[b.status] ?? []).map((a) => (
                  <button
                    key={a.path}
                    className="btn-outline"
                    onClick={() => act.mutate({ id: b.id, path: a.path })}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
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
  const [form, setForm] = useState({ name: '', category: 'venue', city: '', description: '' });
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (current) setForm((f) => ({ ...f, ...current }));
  }, [current]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    try {
      if (current) await api.put(`/vendors/${current.id}`, form);
      else await api.post('/vendors', form);
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
