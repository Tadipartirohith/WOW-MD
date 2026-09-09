import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../../lib/api';
import {
  AllBookings,
  Businesses,
  Directory,
  Staff,
} from '../../components/AdminConsole';
import ReviewModeration from '../../components/ReviewModeration';
import CatalogAdmin from '../../components/CatalogAdmin';
import AdminReportsDashboard from '../../components/AdminReportsDashboard';
import { Loading, EmptyState } from '../../components/ui/Feedback';

/*
 * The dedicated module pages of the Admin Portal (EZ1-I153).
 *
 * Each is a thin wrapper around a section component that already existed inside
 * the combined /admin console; the move is from one component's `section` state
 * to a real route apiece. Nothing here duplicates a data source — every page
 * reads the same /admin endpoints the old console did.
 */

export function AdminUsers() {
  return <Directory title="Users" roles={['', 'bride', 'groom', 'family']} detailBase="/admin/clients" />;
}

export function AdminAgents() {
  return <Directory title="Agents" initialRole="agent" roles={['agent']} detailBase="/admin/agents" />;
}

export function AdminVendors() {
  return (
    <div className="space-y-6">
      <Directory title="Vendors" initialRole="vendor" roles={['vendor']} detailBase="/admin/vendors" />
      <Businesses />
    </div>
  );
}

export function AdminPlanners() {
  return (
    <Directory
      title="Wedding Planners"
      initialRole="planner"
      roles={['planner']}
      detailBase="/admin/planners"
    />
  );
}

export function AdminOfficers() {
  return (
    <div className="space-y-6">
      <Directory
        title="Verification Officers"
        initialRole="in_person"
        roles={['in_person']}
        detailBase="/admin/officers"
      />
      <Staff />
    </div>
  );
}

export function AdminBookings() {
  const [params] = useSearchParams();
  return <AllBookings initialStatus={params.get('status') ?? ''} />;
}

/**
 * Services and catalog, on one screen (EZ1-I174).
 *
 * They were two nav items for one job: a service and the packages under it are
 * created and managed together. CatalogAdmin already holds the whole hierarchy
 * — categories, the services in each, and every service's booking attributes —
 * so the merge is a single nav entry pointing at it, not a new component.
 */
export function AdminServicesCatalog() {
  return <CatalogAdmin />;
}

export function AdminReports() {
  return <AdminReportsDashboard />;
}

/**
 * The approval queues, gathered onto one screen (EZ1-I153).
 *
 * Agencies first: an approved agent can build real accounts for other people,
 * so it is the highest-leverage approval on the platform. Review moderation
 * rides along because it is the same act — the administrator deciding what
 * reaches buyers — and a queue of three does not deserve a route of its own.
 */
export function AdminApprovals() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const q = <T,>(key: string, url: string) =>
    useQuery({
      queryKey: [key],
      queryFn: async () => (await api.get(url)).data as T,
      retry: false,
    });

  const { data: pendingVendors } = q<{ id: string; name: string; category: string; city?: string }[]>(
    'pending-vendors',
    '/admin/vendors/pending',
  );
  const { data: pendingPlanners } = q<{ id: string; agencyName: string; city?: string }[]>(
    'pending-planners',
    '/admin/planners/pending',
  );
  const { data: pendingAgents } = q<
    {
      id: string;
      agencyName: string;
      city?: string;
      registrationNumber: string | null;
      contactPhone: string | null;
      about: string | null;
    }[]
  >('pending-agents', '/admin/agents/pending');

  async function act(url: string, keys: string[], body?: unknown) {
    setError('');
    try {
      await api.put(url, body ?? undefined);
      for (const k of [...keys, 'analytics', 'audit']) qc.invalidateQueries({ queryKey: [k] });
    } catch (err) {
      setError(apiMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">Approvals</h1>
      {error && <p className="alert-critical">{error}</p>}

      <div className="card">
        <h2 className="section-title mb-1">Agencies awaiting approval</h2>
        <p className="mb-3 text-sm text-gray-500">
          An approved agent can build profiles for people who have not joined and invite them to
          create accounts. Check the registration details before approving.
        </p>
        {(pendingAgents ?? []).map((a) => (
          <div key={a.id} className="border-b py-3 last:border-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{a.agencyName}</p>
                <p className="text-sm text-gray-500">
                  {[a.city, a.registrationNumber, a.contactPhone].filter(Boolean).join(' · ') ||
                    'No further details supplied'}
                </p>
                {a.about && <p className="mt-1 text-sm text-gray-600">{a.about}</p>}
              </div>
              <div className="flex gap-2">
                <button
                  className="btn"
                  onClick={() => act(`/admin/agents/${a.id}/approve`, ['pending-agents'])}
                >
                  Approve
                </button>
                <button
                  className="btn-outline"
                  onClick={() => setRejecting(rejecting === a.id ? null : a.id)}
                >
                  Reject
                </button>
              </div>
            </div>
            {rejecting === a.id && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="flex-1">
                  <label className="label">Reason (sent to the agency)</label>
                  <input
                    className="input"
                    minLength={5}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
                <button
                  className="btn-outline"
                  onClick={async () => {
                    await act(`/admin/agents/${a.id}/reject`, ['pending-agents'], { reason });
                    setRejecting(null);
                    setReason('');
                  }}
                >
                  Send rejection
                </button>
              </div>
            )}
          </div>
        ))}
        {!pendingAgents?.length && <p className="text-sm text-gray-400">Nothing pending.</p>}
      </div>

      <div className="card">
        <h2 className="section-title mb-2">Vendors awaiting approval</h2>
        {(pendingVendors ?? []).map((v) => (
          <div
            key={v.id}
            className="flex items-center justify-between border-b py-2 text-sm last:border-0"
          >
            <span>
              {v.name} ({v.category}){v.city ? `, ${v.city}` : ''}
            </span>
            <button
              className="btn-outline"
              onClick={() => act(`/admin/vendors/${v.id}/approve`, ['pending-vendors'])}
            >
              Approve
            </button>
          </div>
        ))}
        {!pendingVendors?.length && <p className="text-sm text-gray-400">Nothing pending.</p>}
      </div>

      <div className="card">
        <h2 className="section-title mb-2">Wedding planners awaiting approval</h2>
        {(pendingPlanners ?? []).map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between border-b py-2 text-sm last:border-0"
          >
            <span>
              {p.agencyName}
              {p.city ? `, ${p.city}` : ''}
            </span>
            <button
              className="btn-outline"
              onClick={() => act(`/admin/planners/${p.id}/approve`, ['pending-planners'])}
            >
              Approve
            </button>
          </div>
        ))}
        {!pendingPlanners?.length && <p className="text-sm text-gray-400">Nothing pending.</p>}
      </div>

      <ReviewModeration />
    </div>
  );
}

/** The audit trail page, made readable (EZ1-I204). Lives in its own file. */
export { default as AdminAuditLogs } from './AdminAuditLogs';

interface Transaction {
  paymentId: string;
  bookingId: string;
  milestone: string;
  status: string;
  amount: string;
  payoutAmount: string;
  createdAt: string;
  buyerName: string | null;
  providerName: string | null;
  providerType: string | null;
}

const TXN_STATUS_STYLE: Record<string, string> = {
  held_in_escrow: 'bg-amber-50 text-amber-800',
  released: 'bg-emerald-50 text-emerald-800',
  disputed: 'bg-red-50 text-red-700',
  refunded: 'bg-gray-100 text-gray-500',
  pending_payout: 'bg-sky-50 text-sky-800',
  partially_settled: 'bg-sky-50 text-sky-800',
};

/**
 * The admin Payments/Transactions page: where the money is (escrow position)
 * and every payment that made it up. The status filter seeds from the URL, so
 * the dashboard's "Held in escrow" card lands here already filtered.
 */
export function AdminPayments() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? '');

  const { data: analytics } = useQuery({
    queryKey: ['analytics'],
    queryFn: async () => (await api.get('/admin/analytics')).data,
    retry: false,
  });
  const escrow: Record<string, string> | undefined = analytics?.escrow?.bookings;

  const { data, isLoading } = useQuery({
    queryKey: ['admin-transactions', status],
    queryFn: async () =>
      (await api.get('/admin/transactions', { params: { limit: 50, status: status || undefined } }))
        .data as { data: Transaction[]; total: number },
  });

  const money = (v?: string) =>
    `₹${Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const rows = data?.data ?? [];

  return (
    <div className="space-y-4">
      {escrow && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <EscrowStat label="Held in escrow" value={money(escrow.held)} tone="text-amber-700" />
          <EscrowStat label="Frozen (disputed)" value={money(escrow.disputed)} tone="text-red-700" />
          <EscrowStat label="Released" value={money(escrow.released)} tone="text-emerald-700" />
          <EscrowStat label="Commission" value={money(escrow.commission)} />
          <EscrowStat label="Refunded" value={money(escrow.refunded)} />
        </div>
      )}

      <div className="card overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">Transactions</h2>
          <select className="input w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            <option value="held_in_escrow">In escrow</option>
            <option value="released">Released</option>
            <option value="disputed">Disputed</option>
            <option value="refunded">Refunded</option>
            <option value="pending_payout">Pending payout</option>
          </select>
        </div>
        {isLoading && <Loading rows={4} />}
        {!isLoading && (
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b bg-surface-sunken text-left text-xs uppercase tracking-wide text-gray-500 [&>th]:px-2 [&>th]:py-2.5">
                <th className="pb-2">Date</th>
                <th className="pb-2">Booking</th>
                <th className="pb-2">Customer</th>
                <th className="pb-2">Provider</th>
                <th className="pb-2">Instalment</th>
                <th className="pb-2 text-right">Amount</th>
                <th className="pb-2 text-right">Payout</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {rows.map((t) => (
                <tr key={t.paymentId}>
                  <td className="py-2 text-gray-600">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 font-mono text-xs text-gray-500">{t.bookingId.slice(0, 8)}</td>
                  <td className="py-2">{t.buyerName ?? '—'}</td>
                  <td className="py-2">
                    {t.providerName ?? (t.providerType === 'planner' ? 'Wedding planner' : '—')}
                  </td>
                  <td className="py-2 capitalize">{t.milestone.replace(/_/g, ' ')}</td>
                  <td className="py-2 text-right">{money(t.amount)}</td>
                  <td className="py-2 text-right text-gray-600">{money(t.payoutAmount)}</td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        TXN_STATUS_STYLE[t.status] ?? 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {t.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-gray-400">
                    No transactions.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function EscrowStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone ?? 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

/**
 * A module named in the portal (EZ1-I153) whose own backend does not exist yet.
 *
 * The route is real and access-gated like the rest, but it says so honestly
 * rather than filling the screen with invented or duplicated data.
 */
export function AdminComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <div className="space-y-4">
      <h1 className="page-title">{title}</h1>
      <EmptyState title="Not built yet">{note}</EmptyState>
    </div>
  );
}
