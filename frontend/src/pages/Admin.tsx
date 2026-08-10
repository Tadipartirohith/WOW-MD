import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';

interface Vendor { id: string; name: string; category: string; city?: string }
interface Analytics { totalUsers: number; totalVendors: number; pendingVendors: number; totalBookings: number; openDisputes: number }

export default function Admin() {
  const qc = useQueryClient();
  const role = useAuth((s) => s.user?.role);

  const { data: analytics } = useQuery({ queryKey: ['analytics'], queryFn: async () => (await api.get('/admin/analytics')).data as Analytics, retry: false });
  const { data: pending } = useQuery({ queryKey: ['pending-vendors'], queryFn: async () => (await api.get('/admin/vendors/pending')).data as Vendor[], retry: false });

  async function approve(id: string) {
    await api.put(`/admin/vendors/${id}/approve`);
    qc.invalidateQueries({ queryKey: ['pending-vendors'] });
    qc.invalidateQueries({ queryKey: ['analytics'] });
  }

  if (role !== 'admin') {
    return <p className="text-gray-600">This area is for administrators. Sign in with an admin account to view it.</p>;
  }

  const cards = analytics
    ? [
        { label: 'Users', value: analytics.totalUsers },
        { label: 'Vendors', value: analytics.totalVendors },
        { label: 'Pending vendors', value: analytics.pendingVendors },
        { label: 'Bookings', value: analytics.totalBookings },
        { label: 'Open disputes', value: analytics.openDisputes },
      ]
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-brand-dark">Admin</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="card text-center">
            <p className="text-2xl font-bold text-brand">{c.value}</p>
            <p className="text-xs text-gray-500">{c.label}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <h2 className="mb-2 font-semibold">Vendors awaiting approval</h2>
        {(pending ?? []).map((v) => (
          <div key={v.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
            <span>{v.name} ({v.category}){v.city ? `, ${v.city}` : ''}</span>
            <button className="btn-outline" onClick={() => approve(v.id)}>Approve</button>
          </div>
        ))}
        {!pending?.length && <p className="text-sm text-gray-400">Nothing pending.</p>}
      </div>
    </div>
  );
}
