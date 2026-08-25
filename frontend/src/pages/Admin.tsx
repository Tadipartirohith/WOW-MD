import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import {
  ActivityFeed,
  AllBookings,
  Businesses,
  Directory,
  Reports,
  Staff,
} from '../components/AdminConsole';
import { BOOKING_STATUS_LABEL } from '../lib/permissions';
import CatalogAdmin from '../components/CatalogAdmin';

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
interface AgentProfile {
  id: string;
  agencyName: string;
  city?: string;
  registrationNumber: string | null;
  contactPhone: string | null;
  about: string | null;
  createdAt: string;
}
interface AuditEvent {
  id: string;
  action: string;
  actorUserId: string | null;
  actorRole: string | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
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
  verification: {
    officers: number;
    awaitingAllocation: number;
    inProgress: number;
    approved: number;
    casesOpen: number;
    casesResolved: number;
  };
  matchmaking: {
    profilesActive: number;
    profilesUnclaimed: number;
    profilesArchived: number;
    matchesFixed: number;
    matchesAwaitingConfirmation: number;
  };
  bookingsByStatus: Record<string, number>;
  escrow: {
    bookings: Record<string, string>;
    agencyFees: Record<string, string>;
  };
}

type Section = 'overview' | 'accounts' | 'businesses' | 'bookings' | 'staff' | 'reports';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'businesses', label: 'Businesses' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'staff', label: 'Staff' },
  { key: 'reports', label: 'Reports' },
];

export default function Admin() {
  const qc = useQueryClient();
  const [section, setSection] = useState<Section>('overview');
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const q = <T,>(key: string, url: string) =>
    useQuery({
      queryKey: [key],
      queryFn: async () => (await api.get(url)).data as T,
      retry: false,
    });

  const { data: analytics } = q<Analytics>('analytics', '/admin/analytics');
  const { data: pendingVendors } = q<Vendor[]>('pending-vendors', '/admin/vendors/pending');
  const { data: pendingPlanners } = q<Planner[]>('pending-planners', '/admin/planners/pending');
  const { data: pendingAgents } = q<AgentProfile[]>('pending-agents', '/admin/agents/pending');
  const { data: audit } = useQuery({
    queryKey: ['audit'],
    queryFn: async () => (await api.get('/admin/audit', { params: { limit: 25 } })).data,
    retry: false,
  });

  async function act(url: string, keys: string[], body?: unknown) {
    setError('');
    try {
      await api.put(url, body ?? undefined);
      for (const k of [...keys, 'analytics', 'audit']) {
        qc.invalidateQueries({ queryKey: [k] });
      }
    } catch (err) {
      setError(apiMessage(err));
    }
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

  const events: AuditEvent[] = audit?.data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-brand-dark">Admin</h1>
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {/*
        Sections rather than one long page. The console had grown to approvals,
        analytics, disputes and an audit trail stacked vertically, and the
        answer to "where do I look at this vendor" was nowhere on it — so the
        page is now split by the question being asked rather than by the table
        the answer comes from.
      */}
      <nav className="flex flex-wrap gap-1 border-b border-gray-200">
        {SECTIONS.map((sct) => (
          <button
            key={sct.key}
            onClick={() => setSection(sct.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              section === sct.key
                ? 'border-brand font-medium text-brand-dark'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {sct.label}
          </button>
        ))}
      </nav>

      {section === 'accounts' && <Directory />}
      {section === 'businesses' && <Businesses />}
      {section === 'bookings' && <AllBookings />}
      {section === 'staff' && <Staff />}
      {section === 'reports' && <Reports />}

      {section === 'overview' && (
      <div className="space-y-6">
      <ActivityFeed />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {cards.map((c) => (
          <div key={c.label} className="card text-center">
            <p className="text-2xl font-bold text-brand">{c.value}</p>
            <p className="text-xs text-gray-500">{c.label}</p>
          </div>
        ))}
      </div>

      <CatalogAdmin />

      {analytics?.matchmaking && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            title="Matchmaking"
            subtitle="What the platform is actually for."
            rows={[
              ['Matches fixed', analytics.matchmaking.matchesFixed],
              ['Awaiting the second confirmation', analytics.matchmaking.matchesAwaitingConfirmation],
              ['Active profiles', analytics.matchmaking.profilesActive],
              ['Profiles with no account yet', analytics.matchmaking.profilesUnclaimed],
              ['Closed', analytics.matchmaking.profilesArchived],
            ]}
          />
          <Panel
            title="Verification"
            subtitle="Work sitting in somebody's queue right now."
            rows={[
              ['Officers on duty', analytics.verification.officers],
              ['Waiting for allocation', analytics.verification.awaitingAllocation],
              ['Visits in progress', analytics.verification.inProgress],
              ['Approved', analytics.verification.approved],
              ['Open cases', analytics.verification.casesOpen],
            ]}
          />
          <Panel
            title="Escrow"
            subtitle="Held is what the platform owes onwards; disputed cannot move."
            rows={[
              ['Held on bookings', `₹${analytics.escrow.bookings.held}`],
              ['Disputed', `₹${analytics.escrow.bookings.disputed}`],
              ['Released to providers', `₹${analytics.escrow.bookings.released}`],
              ['Commission earned', `₹${analytics.escrow.bookings.commission}`],
              ['Agency fees in escrow', `₹${analytics.escrow.agencyFees.held}`],
            ]}
          />
        </div>
      )}

      {analytics?.bookingsByStatus && (
        <div className="card">
          <h2 className="mb-2 font-semibold">Bookings by stage</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(analytics.bookingsByStatus)
              .filter(([, count]) => count > 0)
              .map(([status, count]) => (
                <span key={status} className="rounded-full bg-gray-100 px-3 py-1 text-sm">
                  {BOOKING_STATUS_LABEL[status] ?? status}: <strong>{count}</strong>
                </span>
              ))}
          </div>
        </div>
      )}

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

      {/* Agencies first: an agent can create real accounts for other people, so
          this is the highest-leverage approval on the platform. */}
      <div className="card">
        <h2 className="mb-1 font-semibold">Agencies awaiting approval</h2>
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
        <h2 className="mb-2 font-semibold">Vendors awaiting approval</h2>
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

      <div className="card">
        <h2 className="mb-1 font-semibold">Audit trail</h2>
        <p className="mb-3 text-sm text-gray-500">
          Append-only record of privileged and money-moving actions. Most recent 25.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Actor</th>
                <th className="py-2">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap py-2 pr-3 text-gray-500">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 font-medium">{e.action}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-gray-500">
                    {e.actorRole ?? 'system'}
                  </td>
                  <td className="py-2 text-gray-500">
                    {Object.keys(e.metadata ?? {}).length > 0 ? JSON.stringify(e.metadata) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {events.length === 0 && <p className="text-sm text-gray-400">No events recorded yet.</p>}
      </div>
      </div>
      )}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: [string, string | number][];
}) {
  return (
    <div className="card">
      <h2 className="font-semibold text-gray-900">{title}</h2>
      <p className="mb-2 text-xs text-gray-500">{subtitle}</p>
      <div className="divide-y">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between py-1.5 text-sm">
            <span className="text-gray-600">{label}</span>
            <span className="font-semibold tabular-nums text-gray-900">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
