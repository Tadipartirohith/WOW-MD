import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { BOOKING_STATUS_LABEL } from '../lib/permissions';
import { Loading } from './ui/Feedback';

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
      <h2 className="section-title">Recent activity</h2>
      <p className="mb-3 text-xs text-gray-500">
        The ordinary life of the platform: sign-ups, listings, bookings, complaints. The audit
        trail below is a different thing: it records privileged actions only.
      </p>
      {isLoading && <Loading rows={3} />}
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

export function Directory({
  title = 'Accounts',
  initialRole = '',
  roles = ROLES,
  detailBase,
  hideRoleFilter = false,
}: {
  title?: string;
  initialRole?: string;
  /** The roles offered in the filter — a dedicated page narrows this (EZ1-I123). */
  roles?: readonly string[];
  /**
   * When set, clicking a row opens `${detailBase}/${id}` — the account's own
   * detail page (EZ1-I171/I172) — instead of expanding the summary inline.
   */
  detailBase?: string;
  /**
   * Hide the role dropdown. The Users page fixes the role with tabs instead, so
   * the one-option select would be dead weight (EZ1-I192).
   */
  hideRoleFilter?: boolean;
} = {}) {
  const navigate = useNavigate();
  const [role, setRole] = useState(initialRole);
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
      <h2 className="section-title">{title}</h2>
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
        {!hideRoleFilter && (
          <select className="input w-40" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {r === '' ? 'Any role' : r.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        )}
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
              className="flex w-full items-center justify-between gap-3 py-2 text-left transition-colors hover:bg-brand-soft/40"
              onClick={() =>
                detailBase ? navigate(`${detailBase}/${u.id}`) : setOpenId(openId === u.id ? null : u.id)
              }
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
            {!detailBase && openId === u.id && <AccountDetail userId={u.id} />}
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

  if (!data) return <Loading rows={2} className="py-2" />;

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
    // An agency's own clients — the accounts they brought on (EZ1-I111).
    [
      'Agency clients',
      (data.agency?.clients ?? []).map(
        (u: { id: string; email: string; role: string; isActive: boolean }) => ({
          id: u.id,
          label: u.email,
          note: `${u.role}${u.isActive ? '' : ' · suspended'}`,
        }),
      ),
    ],
  ];

  return (
    <div className="mb-3 grid gap-3 rounded-sm bg-gray-50 p-3 sm:grid-cols-2">
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
      <h2 className="section-title">Businesses</h2>
      <p className="mb-3 text-xs text-gray-500">
        Businesses, not vendor accounts. One account can hold several. {data?.meta.total ?? 0}{' '}
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

interface AdminBookingRow {
  id: string;
  status: string;
  amount: string;
  currency: string;
  eventDate: string | null;
  createdAt: string;
  buyerName: string | null;
  providerName: string | null;
  providerType: string | null;
  serviceName: string | null;
  amountPaid: string;
}

/** The colour a status pill wears. Kept subtle — a state, not an alarm (EZ1-I177). */
const BOOKING_STATUS_TONE: Record<string, string> = {
  requested: 'bg-brand-soft text-brand-strong',
  quotation_sent: 'bg-brand-soft text-brand-strong',
  quotation_accepted: 'bg-brand-soft text-brand-strong',
  payment_pending: 'bg-caution-bg text-caution-fg',
  pending: 'bg-caution-bg text-caution-fg',
  confirmed: 'bg-positive-bg text-positive-fg',
  in_progress: 'bg-positive-bg text-positive-fg',
  completed: 'bg-positive-bg text-positive-fg',
  disputed: 'bg-critical-bg text-critical-fg',
  cancelled: 'bg-gray-100 text-gray-500',
};

/**
 * Every booking, as status tabs each carrying a live count (EZ1-I173).
 *
 * The old "Any stage" dropdown hid the one thing an administrator opens this
 * screen to learn — how much is stuck where. The counts are the platform's own
 * `bookingsByStatus`, so they move when a booking does; nothing here is
 * hardcoded. Each row names who booked whom for what, and opens the full
 * booking on click.
 */
export function AllBookings({ initialStatus = '' }: { initialStatus?: string } = {}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? initialStatus;
  const setStatus = (next: string) => {
    const p = new URLSearchParams(params);
    if (next) p.set('status', next);
    else p.delete('status');
    setParams(p, { replace: true });
  };

  // Counts come from the same analytics read the dashboard uses, so a status
  // with no bookings still shows a 0 rather than vanishing from the tabs.
  const { data: analytics } = useQuery<{
    totalBookings: number;
    bookingsByStatus: Record<string, number>;
  }>({
    queryKey: ['analytics'],
    queryFn: async () => (await api.get('/admin/analytics')).data,
    retry: false,
  });
  const counts = analytics?.bookingsByStatus ?? {};

  const { data, isLoading } = useQuery<{ data: AdminBookingRow[]; meta: { total: number } }>({
    queryKey: ['admin-bookings', status],
    queryFn: async () =>
      (await api.get('/admin/bookings', { params: { limit: 50, status: status || undefined } }))
        .data,
  });

  const tabs: { value: string; label: string; count: number }[] = [
    { value: '', label: 'All', count: analytics?.totalBookings ?? 0 },
    ...Object.entries(BOOKING_STATUS_LABEL).map(([value, label]) => ({
      value,
      label,
      count: counts[value] ?? 0,
    })),
  ];

  const money = (v: string, ccy = 'INR') =>
    `${ccy === 'INR' ? '₹' : `${ccy} `}${Number(v ?? 0).toLocaleString('en-IN')}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Bookings</h1>
        <p className="page-subtitle">
          The whole book, by stage. This is where a dispute starts and the only way to notice
          bookings sitting unpaid.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const active = t.value === status;
          return (
            <button
              key={t.value || 'all'}
              onClick={() => setStatus(t.value)}
              aria-pressed={active}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-gradient-to-r from-brand to-brand-strong text-brand-fg shadow-btn'
                  : 'bg-surface text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100'
              }`}
            >
              <span>{t.label}</span>
              <span
                className={`rounded-full px-1.5 text-xs tabular-nums ${
                  active ? 'bg-white/25 text-brand-fg' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="card overflow-x-auto p-0">
        {isLoading && <Loading rows={5} className="p-5" />}
        {!isLoading && (
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b bg-surface-sunken text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Booking</th>
                <th className="px-4 py-3">Booked by</th>
                <th className="px-4 py-3">Booked with</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {(data?.data ?? []).map((b) => (
                <tr
                  key={b.id}
                  onClick={() => navigate(`/admin/bookings/${b.id}`)}
                  className="cursor-pointer transition-colors hover:bg-brand-soft/40"
                >
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-gray-500">#{b.id.slice(0, 8)}</span>
                    <span className="block text-xs text-gray-400">
                      {b.eventDate ?? new Date(b.createdAt).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-800">{b.buyerName ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-800">
                    {b.providerName ?? '—'}
                    {b.providerType && (
                      <span className="block text-xs capitalize text-gray-400">{b.providerType}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{b.serviceName ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-900">{money(b.amount, b.currency)}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{money(b.amountPaid, b.currency)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`pill ${BOOKING_STATUS_TONE[b.status] ?? 'bg-gray-100 text-gray-600'}`}
                    >
                      {BOOKING_STATUS_LABEL[b.status] ?? b.status}
                    </span>
                  </td>
                </tr>
              ))}
              {data?.data.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                    No bookings in this stage.
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
        <h2 className="section-title">In-person officers</h2>
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
        <h2 className="section-title">Administrator accounts</h2>
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

const REPORTS = [
  'users',
  'agents',
  'vendors',
  'bookings',
  'financial',
  'verification',
  'matchmaking',
] as const;

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
      <h2 className="section-title">Reports</h2>
      <p className="mb-3 text-xs text-gray-500">
        Over a window, inclusive at both ends. Left blank it is the last thirty days. A report
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
            <div key={k} className="rounded-sm bg-gray-50 p-3">
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
