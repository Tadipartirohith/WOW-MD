import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { Permission, can } from '../lib/permissions';
import ClientSelector from '../components/ClientSelector';
import { Loading } from '../components/ui/Feedback';

interface Planner {
  id: string;
  agencyName: string;
  city?: string;
  bio?: string;
  yearsExperience: number;
  ratingAvg: number;
  ratingCount: number;
}

export default function WeddingPlanners() {
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isAgent = can(permissions, Permission.CLIENT_ACT_ON_BEHALF);

  const [city, setCity] = useState('');
  const [onBehalfOf, setOnBehalfOf] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['planners', city],
    queryFn: async () =>
      (await api.get('/wedding-planners/search', { params: city ? { city } : {} })).data,
  });

  async function book(plannerId: string) {
    setBusy(plannerId);
    setMessage('');
    try {
      const payload: Record<string, unknown> = {
        providerType: 'planner',
        providerId: plannerId,
        amount: Number(amount) || 1,
      };
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

  const planners: Planner[] = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="page-title">Hire a Wedding Planner</h1>
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
            <label className="label">City</label>
            <input
              className="input max-w-xs"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Any"
            />
          </div>
        </div>
      </div>

      {message && <p className="rounded-sm bg-brand-light p-3 text-sm text-brand-dark">{message}</p>}
      {isLoading && <Loading rows={3} />}
      {!isLoading && planners.length === 0 && (
        <p className="text-gray-500">No approved planners match that search.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {planners.map((p) => (
          <div key={p.id} className="group/tile card flex flex-col transition-[border-color,box-shadow] duration-200 hover:border-gray-300 hover:shadow-card">
            <div className="flex items-center justify-between">
              <h2 className="section-title">{p.agencyName}</h2>
              <span className="text-sm text-amber-600">
                {p.ratingAvg} ({p.ratingCount})
              </span>
            </div>
            <p className="text-sm text-gray-500">
              {p.city}
              {p.yearsExperience ? ` · ${p.yearsExperience} yrs` : ''}
            </p>
            {p.bio && <p className="mt-2 flex-1 text-sm text-gray-600">{p.bio}</p>}
            <button
              className="btn-outline btn-sm mt-4 w-full transition-colors group-hover/tile:border-brand group-hover/tile:text-brand-strong"
              disabled={busy === p.id || !amount}
              onClick={() => book(p.id)}
            >
              {busy === p.id ? 'Requesting...' : 'Request booking'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
