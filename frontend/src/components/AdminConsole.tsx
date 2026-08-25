import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { BOOKING_STATUS_LABEL } from '../lib/permissions';

/**
 * The parts of the admin console that are about *particular* things.
 *
 * The rest of the Admin page answers "how is the platform doing" — totals,
 * queues, approvals. These answer "what about this one", which is where a real
 * admin session starts: somebody has complained about an account, a business
 * or a booking, and the console has to be able to open it.
 *
 * Kept in their own file because they share nothing with the approval queues
 * except the page they sit on, and a single 900-line Admin.tsx is how the two
 * end up entangled.
 */

interface Activity {
  at: string;
  kind: string;
  summary: string;
  resourceType: string;
  resourceId: string;
}

/** Colour by what kind of thing happened, so the feed can be skimmed. */
const KIND_TONE: Record<string, string> = {
  'account.registered': 'bg-sky-50 text-sky-800',
  'business.created': 'bg-violet-50 text-violet-800',
  'booking.placed': 'bg-emerald-50 text-emerald-800',
  'case.raised': 'bg-red-50 text-red-800',
  'verification.raised': 'bg-amber-50 text-amber-800',
  'client.onboarded': 'bg-gray-100 text-gray-700',
};

export function ActivityFeed() {
  const { data = [], isLoading } = useQuery<Activity[]>({
    queryKey: ['admin-activity'],
    queryFn: async () => (await api.get('/admin/activity', { params: { limit: 40 } })).data,
    // The platform is doing things whether or not anybody refreshes.
    refetchInterval: 60000,
  });

  return (
    <div className="card">
      <h2 className="font-semibold text-gray-900">Recent activity</h2>
      <p className="mb-3 text-xs text-gray-500">
        The ordinary life of the platform — sign-ups, listings, bookings, complaints. The audit
        trail below is a different thing: it records privileged actions only.
      </p>
      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      <div className="max-h-96 divide-y overflow-y-auto">
        {data.map((a) => (
          <div key={`${a.resourceType}-${a.resourceId}-${a.at}`} className="flex gap-3 py-2">
            <span
              className={`h-fit whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${
                KIND_TONE[a.kind] ?? 'bg-gray-100 text-gray-700'
              }`}
            >
              {a.kind.split('.')[1] ?? a.kind}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm text-gray-800">{a.summary}</p>
              <p className="text-xs text-gray-400">{new Date(a.at).toLocaleString()}</p>
            </div>
          </div>
        ))}
      </div>
      {!isLoading && data.length === 0 && (
        <p className="text-sm text-gray-400">Nothing has happened yet.</p>
      )}
    </div>
  );
}

interface DirectoryRow {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  isVerified: boolean;
  createdAt: string;
}

const ROLES = ['', 'bride', 'groom', 'family', 'agent', 'vendor', 'planner', 'in_person', 'admin'];

export function Directory() {
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data } = useQuery<{ data: DirectoryRow[]; meta: { total: number } }>({
    queryKey: ['admin-directory', role, q, active],
    queryFn: async () =>
      (
        await api.get('/admin/directory', {
          params: {
            limit: 25,
            role: role || undefined,
            q: q || undefined,
            active: active === '' ? undefined : active,
          },
        })
      ).data,
  });

  return (
    <div className="card">
      <h2 className="font-semibold text-gray-900">Accounts</h2>
      <p className="mb-3 text-xs text-gray-500">
        {data?.meta.total ?? 0} matching. Suspended accounts are the ones people arrive looking
        for, so they are a filter rather than something to scroll past.
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          className="input flex-1"
          placeholder="Search by email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input w-40" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r === '' ? 'Any role' : r.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select className="input w-40" value={active} onChange={(e) => setActive(e.target.value)}>
          <option value="">Any state</option>
          <option value="true">Active</option>
          <option value="false">Suspended</option>
        </select>
      </div>

      <div className="divide-y">
        {(data?.data ?? []).map((u) => (
          <div key={u.id}>
            <button
              className="flex w-full items-center justify-between gap-3 py-2 text-left"
              onClick={() => setOpenId(openId === u.id ? null : u.id)}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-900">{u.email}</span>
                <span className="text-xs text-gray-500">
                  {u.role.replace(/_/g, ' ')} · joined{' '}
                  {new Date(u.createdAt).toLocaleDateString()}
                </span>
              </span>
              <span
                className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${
                  u.isActive ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
                }`}
              >
                {u.isActive ? 'Active' : 'Suspended'}
              </span>
            </button>
            {openId === u.id && <AccountDetail userId={u.id} />}
          </div>
        ))}
        {data?.data.length === 0 && <p className="py-3 text-sm text-gray-400">Nobody matches.</p>}
      </div>
    </div>
  );
}

/**
 * One account, with everything that hangs off it.
 *
 * Loaded on demand rather than with the list: it is six queries per account,
 * and an administrator opens one of them.
 */
function AccountDetail({ userId }: { userId: string }) {
  const { data } = useQuery({
    queryKey: ['admin-account', userId],
    queryFn: async () => (await api.get(`/admin/accounts/${userId}`)).data,
  });

  if (!data) return <p className="pb-3 text-sm text-gray-400">Loading…</p>;

  const groups: [string, { id: string; label: string; note?: string }[]][] = [
    [
      'Profiles',
      (data.profiles ?? []).map((p: { id: string; displayName: string; lifecycle: string }) => ({
        id: p.id,
        label: p.displayName,
        note: p.lifecycle,
      })),
    ],
    [
      'Businesses',
      (data.businesses ?? []).map((b: { id: string; name: string; status: string }) => ({
        id: b.id,
        label: b.name,
        note: b.status.replace(/_/g, ' '),
      })),
    ],
    [
      'Bookings',
      (data.bookings ?? []).map((b: { id: string; status: string; amount: string }) => ({
        id: b.id,
        label: `₹${b.amount}`,
        note: BOOKING_STATUS_LABEL[b.status] ?? b.status,
      })),
    ],
    [
      'Cases raised',
      (data.casesRaised ?? []).map((c: { id: string; title: string; status: string }) => ({
        id: c.id,
        label: c.title,
        note: c.status.replace(/_/g, ' '),
      })),
    ],
  ];

  return (
    <div className="mb-3 grid gap-3 rounded bg-gray-50 p-3 sm:grid-cols-2">
      {groups.map(([title, rows]) => (
        <div key={title}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</p>
          {rows.length === 0 && <p className="text-sm text-gray-400">None.</p>}
          {rows.map((r) => (
            <p key={r.id} className="truncate text-sm text-gray-700">
              {r.label}
              {r.note && <span className="ml-2 text-xs text-gray-400">{r.note}</span>}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

const BUSINESS_STATES = [
  '',
  'draft',
  'ready_for_review',
  'first_review',
  'pending_verification',
  'verification_in_progress',
  'verified',
  'live',
  'reverification_required',
  'rejected',
];

export function Businesses() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const { data } = useQuery<{
    data: { id: string; name: string; category: string; city: string; status: string }[];
    meta: { total: number };
  }>({
    queryKey: ['admin-businesses', status, q],
    queryFn: async () =>
      (
        await api.get('/admin/businesses', {
          params: { limit: 25, status: status || undefined, q: q || undefined },
        })
      ).data,
  });

  return (
    <div className="card">
      <h2 className="font-semibold text-gray-900">Businesses</h2>
      <p className="mb-3 text-xs text-gray-500">
        Businesses, not vendor accounts — one account can hold several. {data?.meta.total ?? 0}{' '}
        matching.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          className="input flex-1"
          placeholder="Search by name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
          {BUSINESS_STATES.map((sv) => (
            <option key={sv} value={sv}>
              {sv === '' ? 'Any state' : sv.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>
      <div className="divide-y">
        {(data?.data ?? []).map((b) => (
          <div key={b.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{b.name}</p>
              <p className="text-xs text-gray-500">
                {b.category}
                {b.city ? ` · ${b.city}` : ''}
              </p>
            </div>
            <span className="whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
              {b.status.replace(/_/g, ' ')}
            </span>
          </div>
        ))}
        {data?.data.length === 0 && <p className="py-3 text-sm text-gray-400">Nothing matches.</p>}
      </div>
    </div>
  );
}

export function AllBookings() {
  const [status, setStatus] = useState('');

  const { data } = useQuery<{
    data: {
      id: string;
      status: string;
      amount: string;
      currency: string;
      eventDate: string | null;
      createdAt: string;
    }[];
    meta: { total: number };
  }>({
    queryKey: ['admin-bookings', status],
    queryFn: async () =>
      (await api.get('/admin/bookings', { params: { limit: 25, status: status || undefined } }))
        .data,
  });

  return (
    <div className="card">
      <h2 className="font-semibold text-gray-900">Every booking</h2>
      <p className="mb-3 text-xs text-gray-500">
        A vendor sees their incoming work and a buyer their own. This is the whole book, which is
        where a dispute starts and the only way to notice forty bookings sitting unpaid.{' '}
        {data?.meta.total ?? 0} matching.
      </p>
      <select
        className="input mb-3 w-64"
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="">Any stage</option>
        {Object.entries(BOOKING_STATUS_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <div className="divide-y">
        {(data?.data ?? []).map((b) => (
          <div key={b.id} className="flex items-center justify-between gap-3 py-2">
            <div>
              <p className="text-sm font-medium tabular-nums text-gray-900">
                {b.currency} {b.amount}
              </p>
              <p className="text-xs text-gray-500">
                {b.eventDate ?? 'no date set'} · #{b.id.slice(0, 8)}
              </p>
            </div>
            <span className="whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
              {BOOKING_STATUS_LABEL[b.status] ?? b.status}
            </span>
          </div>
        ))}
        {data?.data.length === 0 && <p className="py-3 text-sm text-gray-400">Nothing matches.</p>}
      </div>
    </div>
  );
}

interface StaffRow {
  id: string;
  email: string;
  isActive: boolean;
  openCases: number;
  openVisits: number;
}

/**
 * Administrators and field officers, listed apart.
 *
 * They are not two flavours of staff. One decides who gets operational access;
 * the other travels to an address and writes down what they saw. Only the
 * second has a workload, and the two numbers are kept separate because six
 * visits and six disputes are different amounts of work — an allocator picking
 * on the sum picks the wrong officer.
 */
export function Staff() {
  const admins = useQuery<StaffRow[]>({
    queryKey: ['admin-staff', 'admin'],
    queryFn: async () => (await api.get('/admin/staff/admin')).data,
  });
  const officers = useQuery<StaffRow[]>({
    queryKey: ['admin-staff', 'in_person'],
    queryFn: async () => (await api.get('/admin/staff/in_person')).data,
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card">
        <h2 className="font-semibold text-gray-900">In-person officers</h2>
        <p className="mb-2 text-xs text-gray-500">Who is carrying what, right now.</p>
        <div className="divide-y">
          {(officers.data ?? []).map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-sm text-gray-800">{o.email}</span>
              <span className="whitespace-nowrap text-xs text-gray-500">
                {o.openVisits} visit(s) · {o.openCases} case(s)
                {!o.isActive && <span className="ml-2 text-red-700">inactive</span>}
              </span>
            </div>
          ))}
          {officers.data?.length === 0 && (
            <p className="py-2 text-sm text-gray-400">No officers yet.</p>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold text-gray-900">Administrator accounts</h2>
        <p className="mb-2 text-xs text-gray-500">
          Separate on purpose. These accounts decide who gets access; listing them beside the
          officers is how somebody is given the wrong one.
        </p>
        <div className="divide-y">
          {(admins.data ?? []).map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-sm text-gray-800">{a.email}</span>
              <span
                className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${
                  a.isActive ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
                }`}
              >
                {a.isActive ? 'Active' : 'Suspended'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const REPORTS = ['users', 'agents', 'vendors', 'bookings', 'financial', 'verification'] as const;

export function Reports() {
  const [kind, setKind] = useState<(typeof REPORTS)[number]>('bookings');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, isFetching } = useQuery<Record<string, unknown>>({
    queryKey: ['admin-report', kind, from, to],
    queryFn: async () =>
      (
        await api.get('/admin/reports', {
          params: { kind, from: from || undefined, to: to || undefined },
        })
      ).data,
  });

  // Everything that is not a bare number goes in its own block, so a report
  // full of breakdowns does not render as one wall of JSON.
  const scalars = Object.entries(data ?? {}).filter(
    ([k, v]) => !['kind', 'from', 'to'].includes(k) && (typeof v === 'number' || typeof v === 'string'),
  );
  const groups = Object.entries(data ?? {}).filter(
    ([, v]) => v !== null && typeof v === 'object',
  ) as [string, Record<string, number>][];

  return (
    <div className="card">
      <h2 className="font-semibold text-gray-900">Reports</h2>
      <p className="mb-3 text-xs text-gray-500">
        Over a window, inclusive at both ends. Left blank it is the last thirty days — a report
        with no window means &ldquo;everything ever&rdquo;, which reads as a catastrophic month.
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        <select
          className="input w-48"
          value={kind}
          onChange={(e) => setKind(e.target.value as (typeof REPORTS)[number])}
        >
          {REPORTS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input
          className="input w-44"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          className="input w-44"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </div>

      {isFetching && <p className="text-sm text-gray-400">Working…</p>}

      {scalars.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {scalars.map(([k, v]) => (
            <div key={k} className="rounded bg-gray-50 p-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">
                {k.replace(/([A-Z])/g, ' $1').toLowerCase()}
              </p>
              <p className="text-lg font-semibold tabular-nums text-gray-900">{String(v)}</p>
            </div>
          ))}
        </div>
      )}

      {groups.map(([title, rows]) => (
        <div key={title} className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {title.replace(/([A-Z])/g, ' $1').toLowerCase()}
          </p>
          <div className="mt-1 divide-y">
            {Object.entries(rows)
              // A breakdown where most buckets are zero is mostly noise; the
              // zeros are still in the response for anyone reading the API.
              .filter(([, v]) => Number(v) !== 0)
              .map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-1 text-sm">
                  <span className="text-gray-600">{k.replace(/_/g, ' ')}</span>
                  <span className="font-medium tabular-nums text-gray-900">{String(v)}</span>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
