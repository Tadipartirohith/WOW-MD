import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

interface Booking {
  id: string;
  vendorId: string;
  amount: string;
  currency: string;
  status: string;
}

const ACTIONS: Record<string, { label: string; path: string }[]> = {
  requested: [{ label: 'Pay (escrow)', path: 'pay' }, { label: 'Cancel', path: 'cancel' }],
  pending: [{ label: 'Confirm', path: 'confirm' }, { label: 'Cancel', path: 'cancel' }],
  confirmed: [{ label: 'Complete', path: 'complete' }, { label: 'Cancel', path: 'cancel' }],
  completed: [],
  cancelled: [],
};

export default function Bookings() {
  const qc = useQueryClient();
  const [vendorId, setVendorId] = useState('');
  const [amount, setAmount] = useState('');

  const { data } = useQuery({
    queryKey: ['bookings'],
    queryFn: async () => (await api.get('/bookings')).data as Booking[],
  });

  async function create(e: FormEvent) {
    e.preventDefault();
    await api.post('/bookings', { vendorId, amount: Number(amount) });
    setVendorId('');
    setAmount('');
    qc.invalidateQueries({ queryKey: ['bookings'] });
  }

  async function act(id: string, path: string) {
    await api.put(`/bookings/${id}/${path}`);
    qc.invalidateQueries({ queryKey: ['bookings'] });
  }

  const bookings = data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-brand-dark">Bookings & Escrow</h1>

      <form onSubmit={create} className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Vendor ID</label>
          <input className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)} required />
        </div>
        <div>
          <label className="label">Amount</label>
          <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <button className="btn">Request booking</button>
      </form>

      <div className="card divide-y">
        {bookings.length === 0 && <p className="text-sm text-gray-400">No bookings yet.</p>}
        {bookings.map((b) => (
          <div key={b.id} className="flex items-center justify-between py-3">
            <div>
              <p className="font-medium">Vendor {b.vendorId.slice(0, 8)}...</p>
              <p className="text-sm text-gray-500">
                {b.currency} {b.amount}, status <span className="font-medium">{b.status}</span>
              </p>
            </div>
            <div className="flex gap-2">
              {(ACTIONS[b.status] ?? []).map((a) => (
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
