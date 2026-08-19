import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { Permission, can } from '../lib/permissions';
import ClientSelector from '../components/ClientSelector';

const CATEGORIES = ['', 'venue', 'catering', 'photography', 'decor', 'makeup', 'entertainment'];

interface Vendor {
  id: string;
  name: string;
  category: string;
  city?: string;
  description?: string;
  ratingAvg: number;
  ratingCount: number;
}

export default function Vendors() {
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isAgent = can(permissions, Permission.CLIENT_ACT_ON_BEHALF);

  const [category, setCategory] = useState('');
  const [onBehalfOf, setOnBehalfOf] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['vendors', category],
    queryFn: async () =>
      (await api.get('/vendors/search', { params: category ? { category } : {} })).data,
  });

  async function book(vendorId: string) {
    setBusy(vendorId);
    setMessage('');
    try {
      const payload: Record<string, unknown> = {
        providerType: 'vendor',
        providerId: vendorId,
        amount: Number(amount) || 1,
      };
      // Only an agent may send this; the server rejects it from anyone else.
      if (isAgent && onBehalfOf) payload.onBehalfOfUserId = onBehalfOf;
      await api.post('/bookings', payload);
      setMessage('Booking requested. Pay to move it into escrow from the Bookings page.');
    } catch (err) {
      const msg = (err as AxiosError<{ message?: string | string[] }>).response?.data?.message;
      setMessage(Array.isArray(msg) ? msg.join('. ') : msg || 'Could not create the booking.');
    } finally {
      setBusy('');
    }
  }

  const vendors: Vendor[] = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-bold text-brand-dark">Vendor Marketplace</h1>
        <div className="flex flex-wrap items-end gap-3">
          {isAgent && <ClientSelector value={onBehalfOf} onChange={setOnBehalfOf} />}
          <div>
            <label className="label">Quoted amount</label>
            <input
              className="input max-w-[10rem]"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Category</label>
            <select
              className="input max-w-xs"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c ? c : 'All categories'}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {message && <p className="rounded bg-brand-light p-3 text-sm text-brand-dark">{message}</p>}
      {isLoading && <p className="text-gray-500">Loading...</p>}
      {!isLoading && vendors.length === 0 && <p className="text-gray-500">No vendors found.</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {vendors.map((v) => (
          <div key={v.id} className="card flex flex-col">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{v.name}</h2>
              <span className="text-sm text-amber-600">
                {v.ratingAvg} ({v.ratingCount})
              </span>
            </div>
            <p className="text-xs uppercase tracking-wide text-gray-400">{v.category}</p>
            <p className="text-sm text-gray-500">{v.city}</p>
            {v.description && <p className="mt-2 flex-1 text-sm text-gray-600">{v.description}</p>}
            <button
              className="btn mt-3"
              disabled={busy === v.id || !amount}
              onClick={() => book(v.id)}
            >
              {busy === v.id ? 'Requesting...' : 'Request booking'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
