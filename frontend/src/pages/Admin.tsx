import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

interface Vendor {
  id: string;
  name: string;
  category: string;
  city?: string;
}
interface Planner {
  id: string;
  agencyName: string;
  city?: string;
}
interface Analytics {
  totalUsers: number;
  totalVendors: number;
  pendingVendors: number;
  totalPlanners: number;
  pendingPlanners: number;
  totalAgents: number;
  totalBookings: number;
  openDisputes: number;
  usersByRole: { role: string; count: number }[];
}

/**
 * Admin console. The route itself is permission-gated in App.tsx, and every
 * endpoint below is gated server-side, so this component no longer needs its
 * own role check to avoid rendering for the wrong persona.
 */
export default function Admin() {
  const qc = useQueryClient();

  const { data: analytics } = useQuery({
    queryKey: ['analytics'],
    queryFn: async () => (await api.get('/admin/analytics')).data as Analytics,
    retry: false,
  });
  const { data: pendingVendors } = useQuery({
    queryKey: ['pending-vendors'],
    queryFn: async () => (await api.get('/admin/vendors/pending')).data as Vendor[],
    retry: false,
  });
  const { data: pendingPlanners } = useQuery({
    queryKey: ['pending-planners'],
    queryFn: async () => (await api.get('/admin/planners/pending')).data as Planner[],
    retry: false,
  });

  async function approveVendor(id: string) {
    await api.put(`/admin/vendors/${id}/approve`);
    qc.invalidateQueries({ queryKey: ['pending-vendors'] });
    qc.invalidateQueries({ queryKey: ['analytics'] });
  }

  async function approvePlanner(id: string) {
    await api.put(`/admin/planners/${id}/approve`);
    qc.invalidateQueries({ queryKey: ['pending-planners'] });
    qc.invalidateQueries({ queryKey: ['analytics'] });
  }

  const cards = analytics
    ? [
        { label: 'Users', value: analytics.totalUsers },
        { label: 'Agents', value: analytics.totalAgents },
        { label: 'Vendors', value: analytics.totalVendors },
        { label: 'Planners', value: analytics.totalPlanners },
        { label: 'Bookings', value: analytics.totalBookings },
        { label: 'Open disputes', value: analytics.openDisputes },
      ]
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-brand-dark">Admin</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="card text-center">
            <p className="text-2xl font-bold text-brand">{c.value}</p>
            <p className="text-xs text-gray-500">{c.label}</p>
          </div>
        ))}
      </div>

      {analytics?.usersByRole && (
        <div className="card">
          <h2 className="mb-2 font-semibold">Accounts by type</h2>
          <div className="flex flex-wrap gap-2">
            {analytics.usersByRole.map((r) => (
              <span key={r.role} className="rounded-full bg-gray-100 px-3 py-1 text-sm">
                {r.role}: <strong>{r.count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="mb-2 font-semibold">Vendors awaiting approval</h2>
        {(pendingVendors ?? []).map((v) => (
          <div
            key={v.id}
            className="flex items-center justify-between border-b py-2 text-sm last:border-0"
          >
            <span>
              {v.name} ({v.category}){v.city ? `, ${v.city}` : ''}
            </span>
            <button className="btn-outline" onClick={() => approveVendor(v.id)}>
              Approve
            </button>
          </div>
        ))}
        {!pendingVendors?.length && <p className="text-sm text-gray-400">Nothing pending.</p>}
      </div>

      <div className="card">
        <h2 className="mb-2 font-semibold">Wedding planners awaiting approval</h2>
        {(pendingPlanners ?? []).map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between border-b py-2 text-sm last:border-0"
          >
            <span>
              {p.agencyName}
              {p.city ? `, ${p.city}` : ''}
            </span>
            <button className="btn-outline" onClick={() => approvePlanner(p.id)}>
              Approve
            </button>
          </div>
        ))}
        {!pendingPlanners?.length && <p className="text-sm text-gray-400">Nothing pending.</p>}
      </div>
    </div>
  );
}
