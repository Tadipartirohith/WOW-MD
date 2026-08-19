import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { Permission, can } from '../lib/permissions';

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

/**
 * Actions available to the *buyer* side. Confirm and complete are deliberately
 * absent: those belong to the provider, and the server refuses them here.
 */
const BUYER_ACTIONS: Record<string, { label: string; path: string }[]> = {
  requested: [
    { label: 'Pay (escrow)', path: 'pay' },
    { label: 'Cancel', path: 'cancel' },
  ],
  pending: [{ label: 'Cancel', path: 'cancel' }],
  confirmed: [{ label: 'Cancel', path: 'cancel' }],
  completed: [],
  cancelled: [],
};

export default function Bookings() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const canBuy = can(permissions, Permission.BOOKING_READ_OWN);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['bookings', status],
    queryFn: async () =>
      (await api.get('/bookings', { params: status ? { status } : {} })).data,
    enabled: canBuy,
  });

  async function act(id: string, path: string) {
    setError('');
    try {
      await api.put(`/bookings/${id}/${path}`, path === 'cancel' ? {} : undefined);
      qc.invalidateQueries({ queryKey: ['bookings'] });
    } catch (err) {
      const msg = (err as AxiosError<{ message?: string | string[] }>).response?.data?.message;
      setError(Array.isArray(msg) ? msg.join('. ') : msg || 'That action was rejected.');
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
          {['requested', 'pending', 'confirmed', 'completed', 'cancelled'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <p className="text-sm text-gray-500">
        Request a booking from the <strong>Vendors</strong> or <strong>Planners</strong> page, then
        pay here to move the funds into escrow. The provider confirms and completes; escrow is
        released on completion and refunded on cancellation.
      </p>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {isLoading && <p className="text-gray-500">Loading...</p>}

      <div className="card divide-y">
        {!isLoading && bookings.length === 0 && (
          <p className="text-sm text-gray-400">No bookings yet.</p>
        )}
        {bookings.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-medium">
                <span className="text-xs uppercase tracking-wide text-gray-400">
                  {b.providerType}
                </span>{' '}
                {b.providerId.slice(0, 8)}…
              </p>
              <p className="text-sm text-gray-500">
                {b.currency} {b.amount}
                {b.eventDate ? ` · event ${b.eventDate}` : ''} · status{' '}
                <span className="font-medium">{b.status}</span>
                {b.bookedByUserId !== b.userId && ' · booked by your agent'}
              </p>
            </div>
            <div className="flex gap-2">
              {(BUYER_ACTIONS[b.status] ?? []).map((a) => (
                <button key={a.path} className="btn-outline" onClick={() => act(b.id, a.path)}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
