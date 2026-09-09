import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../../lib/api';
import {
  AllBookings,
  Businesses,
  Directory,
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

/**
 * The matrimonial users — brides, grooms and family stewards — as one tab each
 * (EZ1-I192).
 *
 * Vendors, planners, agents and officers are user accounts too, but each has
 * its own page; this screen is only the people the platform matches. The old
 * "Any role" dropdown let all of them leak in, so it is gone: the tab fixes the
 * role, and its badge carries the live count for that role (unfiltered by the
 * search below it). The list, its email search and its status filter are the
 * shared Directory, told to hide its now-redundant role select.
 */
const USER_TABS = [
  { role: 'bride', label: 'Brides' },
  { role: 'groom', label: 'Grooms' },
  { role: 'family', label: 'Family' },
] as const;

export function AdminUsers() {
  const [params, setParams] = useSearchParams();
  const role = params.get('role') || USER_TABS[0].role;
  const setRole = (r: string) => {
    const p = new URLSearchParams(params);
    p.set('role', r);
    setParams(p, { replace: true });
  };

  // One badge count per role, straight from the directory's own total so a role
  // that gains a user sees its tab move. Kept apart from the list query below,
  // whose total narrows with the email and status filters.
  const { data: counts } = useQuery<Record<string, number>>({
    queryKey: ['admin-user-counts'],
    queryFn: async () => {
      const entries = await Promise.all(
        USER_TABS.map(
          async (t) =>
            [
              t.role,
              (await api.get('/admin/directory', { params: { limit: 1, role: t.role } })).data.meta
                .total as number,
            ] as const,
        ),
      );
      return Object.fromEntries(entries);
    },
  });

  const active = USER_TABS.find((t) => t.role === role) ?? USER_TABS[0];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Users</h1>
        <p className="page-subtitle">
          Brides, grooms and families — the people the platform matches. Vendors, planners,
          agents and officers each have their own page.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {USER_TABS.map((t) => {
          const isActive = t.role === role;
          return (
            <button
              key={t.role}
              onClick={() => setRole(t.role)}
              aria-pressed={isActive}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-gradient-to-r from-brand to-brand-strong text-brand-fg shadow-btn'
                  : 'bg-surface text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100'
              }`}
            >
              <span>{t.label}</span>
              <span
                className={`rounded-full px-1.5 text-xs tabular-nums ${
                  isActive ? 'bg-white/25 text-brand-fg' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {counts?.[t.role] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <Directory
        key={role}
        title={active.label}
        initialRole={role}
        roles={[role]}
        hideRoleFilter
        detailBase="/admin/clients"
      />
    </div>
  );
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

/**
 * The verification officers, as a roster an administrator can run (EZ1-I212).
 *
 * The old page was the generic account directory plus a two-line staff card —
 * enough to find an officer, not enough to manage one. This is the management
 * view the role needs: who covers where, whose account is live, who is online,
 * and the shape of each queue split into verifications and cases, with suspend
 * and reinstate on the row so a decision does not need a detour through the
 * detail page. Every number is the backend's own aggregate — the same ones the
 * allocator ranks on — so nothing here can quietly disagree with a visit that
 * was actually handed out.
 *
 * Availability (Available / On Leave / Unavailable) is a separate change
 * (EZ1-I210). Until its field lands the column reads "Available" for everyone
 * and its two other filters simply match nobody; both start working the day
 * the field arrives, with no further edit here.
 */
interface OfficerRow {
  id: string;
  email: string;
  name: string | null;
  city: string | null;
  isActive: boolean;
  availability: 'available' | 'on_leave' | 'unavailable';
  online: boolean;
  lastActiveAt: string | null;
  serviceAreas: { label: string; primary: boolean }[];
  verifications: { pending: number; inProgress: number; completed: number };
  cases: { pending: number; inProgress: number; completed: number };
  visitsCompleted: number;
  joinedAt: string;
}

const OFFICER_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'available', label: 'Available' },
  { key: 'on_leave', label: 'On Leave' },
  { key: 'unavailable', label: 'Unavailable' },
] as const;

type OfficerFilter = (typeof OFFICER_FILTERS)[number]['key'];

const officerMatches = (o: OfficerRow, f: OfficerFilter): boolean => {
  switch (f) {
    case 'active':
      return o.isActive;
    case 'suspended':
      return !o.isActive;
    case 'available':
      return o.availability === 'available';
    case 'on_leave':
      return o.availability === 'on_leave';
    case 'unavailable':
      return o.availability === 'unavailable';
    default:
      return true;
  }
};

const AVAILABILITY_META: Record<OfficerRow['availability'], { label: string; tone: string }> = {
  available: { label: 'Available', tone: 'bg-positive-bg text-positive-fg' },
  on_leave: { label: 'On Leave', tone: 'bg-caution-bg text-caution-fg' },
  unavailable: { label: 'Unavailable', tone: 'bg-gray-100 text-gray-500' },
};

/** Compact "when were they last seen" — the question presence answers. */
function lastActiveLabel(iso: string | null): string {
  if (!iso) return 'Never';
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** verifications/cases as one "pending · in progress · done" cluster. */
function QueueCounts({ q }: { q: OfficerRow['verifications'] }) {
  return (
    <span className="whitespace-nowrap text-xs tabular-nums text-gray-600">
      <span className="text-caution-fg" title="Pending">
        {q.pending}
      </span>
      {' · '}
      <span className="text-brand-strong" title="In progress">
        {q.inProgress}
      </span>
      {' · '}
      <span className="text-positive-fg" title="Completed">
        {q.completed}
      </span>
    </span>
  );
}

export function AdminOfficers() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<OfficerFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery<OfficerRow[]>({
    queryKey: ['admin-officers'],
    queryFn: async () => (await api.get('/admin/officers')).data,
  });

  const officers = data ?? [];
  const count = (f: OfficerFilter) => officers.filter((o) => officerMatches(o, f)).length;
  const shown = officers.filter((o) => officerMatches(o, filter));

  async function setActive(id: string, active: boolean) {
    if (!window.confirm(active ? 'Reinstate this officer?' : 'Suspend this officer?')) return;
    setError('');
    setBusyId(id);
    try {
      await api.put(`/admin/users/${id}/status`, { isActive: active });
      for (const k of ['admin-officers', 'analytics', 'audit']) qc.invalidateQueries({ queryKey: [k] });
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Verification Officers</h1>
        <p className="page-subtitle">
          The field team that goes to an address and writes down what they saw. Who covers where,
          who is free, and what each is carrying — open the row for the full record.
        </p>
      </div>

      {error && <p className="alert-critical">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {OFFICER_FILTERS.map((f) => {
          const isActive = f.key === filter;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={isActive}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-gradient-to-r from-brand to-brand-strong text-brand-fg shadow-btn'
                  : 'bg-surface text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100'
              }`}
            >
              <span>{f.label}</span>
              <span
                className={`rounded-full px-1.5 text-xs tabular-nums ${
                  isActive ? 'bg-white/25 text-brand-fg' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {count(f.key)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="card overflow-x-auto p-0">
        {isLoading && <Loading rows={5} className="p-5" />}
        {!isLoading && shown.length === 0 && (
          <EmptyState title="No officers here">
            No verification officer matches this filter.
          </EmptyState>
        )}
        {!isLoading && shown.length > 0 && (
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b bg-surface-sunken text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Officer</th>
                <th className="px-4 py-3">Coverage</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Availability</th>
                <th className="px-4 py-3">Presence</th>
                <th className="px-4 py-3">Verifications</th>
                <th className="px-4 py-3">Cases</th>
                <th className="px-4 py-3 text-right">Visits</th>
                <th className="px-4 py-3 text-right">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((o) => {
                const avail = AVAILABILITY_META[o.availability];
                return (
                  <tr
                    key={o.id}
                    onClick={() => navigate(`/admin/officers/${o.id}`)}
                    className="cursor-pointer transition-colors hover:bg-brand-soft/40"
                  >
                    <td className="px-4 py-3">
                      <span className="block font-medium text-gray-900">{o.name ?? o.email}</span>
                      <span className="block truncate text-xs text-gray-500">{o.email}</span>
                      <span className="block font-mono text-[11px] text-gray-400">
                        #{o.id.slice(0, 8)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {o.serviceAreas.length === 0 ? (
                        <span className="text-xs text-gray-400">No areas set</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {o.serviceAreas.slice(0, 3).map((a, i) => (
                            <span
                              key={`${a.label}-${i}`}
                              className={`rounded-full px-2 py-0.5 text-xs ${
                                a.primary
                                  ? 'bg-brand-soft text-brand-strong'
                                  : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {a.label}
                            </span>
                          ))}
                          {o.serviceAreas.length > 3 && (
                            <span className="text-xs text-gray-400">
                              +{o.serviceAreas.length - 3}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`pill ${
                          o.isActive
                            ? 'bg-positive-bg text-positive-fg'
                            : 'bg-critical-bg text-critical-fg'
                        }`}
                      >
                        {o.isActive ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`pill ${avail.tone}`}>{avail.label}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-gray-600">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            o.online ? 'bg-emerald-500' : 'bg-gray-300'
                          }`}
                          aria-hidden
                        />
                        {o.online ? 'Online' : lastActiveLabel(o.lastActiveAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <QueueCounts q={o.verifications} />
                    </td>
                    <td className="px-4 py-3">
                      <QueueCounts q={o.cases} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                      {o.visitsCompleted}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn-ghost btn-sm"
                        disabled={busyId === o.id}
                        onClick={() => setActive(o.id, !o.isActive)}
                      >
                        {o.isActive ? 'Suspend' : 'Reinstate'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Queue counts read pending · in progress · completed. Availability arrives with the officer
        leave feature (EZ1-I210); until then every officer shows as Available.
      </p>
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
  const navigate = useNavigate();
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
                <tr
                  key={t.paymentId}
                  onClick={() => navigate(`/admin/payments/${t.paymentId}`)}
                  className="cursor-pointer hover:bg-surface-sunken"
                >
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
