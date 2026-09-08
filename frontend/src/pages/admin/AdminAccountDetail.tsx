import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CaretLeft } from '@phosphor-icons/react';
import { api, apiMessage } from '../../lib/api';
import { formatDate } from '../../lib/dates';
import { BOOKING_STATUS_LABEL } from '../../lib/permissions';
import { EmptyState, Loading } from '../../components/ui/Feedback';

/**
 * One account and everything hanging off it, as a dedicated page (EZ1-I171,
 * EZ1-I172).
 *
 * The same drill-down for agents, their clients, vendors, wedding planners and
 * verification officers — they are all user accounts, and `/admin/accounts/:id`
 * already returns the profiles, businesses, bookings, cases, payments,
 * matchmaking, agency book and officer workload for any of them. This page
 * renders whichever of those the account actually has, and links every related
 * account and booking through to its own detail page. No data is invented: a
 * section with nothing behind it is not shown.
 */

type Kind = 'agent' | 'client' | 'vendor' | 'planner' | 'officer';

const KIND: Record<Kind, { title: string; listRoute: string; listLabel: string }> = {
  agent: { title: 'Agent', listRoute: '/admin/agents', listLabel: 'Agents' },
  client: { title: 'Client', listRoute: '/admin/users', listLabel: 'Users' },
  vendor: { title: 'Vendor', listRoute: '/admin/vendors', listLabel: 'Vendors' },
  planner: { title: 'Wedding planner', listRoute: '/admin/planners', listLabel: 'Wedding Planners' },
  officer: {
    title: 'Verification officer',
    listRoute: '/admin/officers',
    listLabel: 'Verification Officers',
  },
};

interface AccountUser {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  isVerified: boolean;
  managedByAgentId: string | null;
  phone: string | null;
  createdAt: string;
}

interface RelatedAccount {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface BookingRow {
  id: string;
  status: string;
  amount: string;
  currency: string;
  eventDate: string | null;
  createdAt: string;
}

interface AccountDetail {
  user: AccountUser;
  profiles: { id: string; displayName: string; lifecycle: string; city: string | null }[];
  businesses: { id: string; name: string; category: string; status: string; isApproved: boolean }[];
  bookings: BookingRow[];
  providerBookings: (BookingRow & { buyerName: string | null; serviceName: string | null; amountPaid: string })[];
  plannerBusinesses: { id: string; name: string; city: string | null; isApproved: boolean }[];
  casesRaised: { id: string; title: string; status: string; createdAt: string }[];
  casesAssigned: { id: string; title: string; status: string; createdAt: string }[];
  verifications: { id: string; applicantType: string; status: string; createdAt: string }[];
  matchmaking: { sent: number; received: number; accepted: number; fixed: number } | null;
  payments: {
    total: string;
    inEscrow: string;
    released: string;
    refunded: string;
    history: { id: string; amount: string; status: string; milestone: string; createdAt: string }[];
  };
  agency: { clients: RelatedAccount[]; charges: { id: string; amount: string; status: string; createdAt: string }[] } | null;
  officer: {
    assigned: number;
    open: number;
    overdue: number;
    queue: { id: string; applicantType: string; status: string; createdAt: string }[];
  } | null;
}

const money = (v: string) => `₹${Number(v ?? 0).toLocaleString('en-IN')}`;

export default function AdminAccountDetail({ kind }: { kind: Kind }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const meta = KIND[kind];

  const { data, isLoading, error } = useQuery<AccountDetail>({
    queryKey: ['admin-account-detail', id],
    queryFn: async () => (await api.get(`/admin/accounts/${id}`)).data,
    retry: false,
  });

  const back = (
    <button
      onClick={() => navigate(meta.listRoute)}
      className="btn-ghost btn-sm -ml-2 text-gray-500"
    >
      <CaretLeft size={15} aria-hidden /> Back to {meta.listLabel}
    </button>
  );

  if (isLoading) return <Loading rows={6} />;
  if (error || !data)
    return (
      <div className="space-y-4">
        {back}
        <EmptyState title={`${meta.title} not found`}>
          {apiMessage(error, 'That record could not be opened.')}
        </EmptyState>
      </div>
    );

  const { user } = data;
  const name = data.profiles[0]?.displayName || user.email;

  return (
    <div className="space-y-5">
      {back}

      <div className="card bg-gradient-to-br from-brand-soft to-surface">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-brand-strong">{meta.title}</p>
            <h1 className="page-title truncate">{name}</h1>
            <p className="page-subtitle">{user.email}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`pill ${user.isActive ? 'bg-positive-bg text-positive-fg' : 'bg-critical-bg text-critical-fg'}`}>
              {user.isActive ? 'Active' : 'Suspended'}
            </span>
            <span className={`pill ${user.isVerified ? 'bg-positive-bg text-positive-fg' : 'bg-gray-100 text-gray-500'}`}>
              {user.isVerified ? 'Verified' : 'Unverified'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Overview">
          <Row label="Account ID">
            <span className="font-mono text-xs">{user.id.slice(0, 8)}</span>
          </Row>
          <Row label="Email">{user.email}</Row>
          <Row label="Mobile">{user.phone ?? '—'}</Row>
          <Row label="Role">{user.role.replace(/_/g, ' ')}</Row>
          <Row label="Registered">{formatDate(user.createdAt)}</Row>
          {user.managedByAgentId && (
            <Link className="btn-outline btn-sm mt-2" to={`/admin/agents/${user.managedByAgentId}`}>
              Managing agency
            </Link>
          )}
        </Section>

        <Section title="Money">
          <Row label="Paid in total">{money(data.payments.total)}</Row>
          <Row label="Held in escrow">{money(data.payments.inEscrow)}</Row>
          <Row label="Released">{money(data.payments.released)}</Row>
          <Row label="Refunded">{money(data.payments.refunded)}</Row>
        </Section>

        {data.matchmaking && (
          <Section title="Matchmaking">
            <Row label="Interests sent">{String(data.matchmaking.sent)}</Row>
            <Row label="Received">{String(data.matchmaking.received)}</Row>
            <Row label="Accepted">{String(data.matchmaking.accepted)}</Row>
            <Row label="Match fixed">{data.matchmaking.fixed > 0 ? 'Yes' : 'No'}</Row>
          </Section>
        )}

        {data.officer && (
          <Section title="Verification workload">
            <Row label="Allocated">{String(data.officer.assigned)}</Row>
            <Row label="Still open">{String(data.officer.open)}</Row>
            <Row label="Past the deadline">{String(data.officer.overdue)}</Row>
          </Section>
        )}
      </div>

      {/* An agency's book: the accounts they brought on, each clickable (EZ1-I171). */}
      {data.agency && (
        <ListSection
          title="Assigned clients"
          empty="No clients yet."
          rows={data.agency.clients}
          render={(c) => (
            <Link
              key={c.id}
              to={`/admin/clients/${c.id}`}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-brand-soft/40"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-900">{c.email}</span>
                <span className="text-xs text-gray-500">
                  {c.role.replace(/_/g, ' ')} · joined {formatDate(c.createdAt)}
                </span>
              </span>
              <span className={`pill ${c.isActive ? 'bg-positive-bg text-positive-fg' : 'bg-critical-bg text-critical-fg'}`}>
                {c.isActive ? 'Active' : 'Suspended'}
              </span>
            </Link>
          )}
        />
      )}

      {data.profiles.length > 0 && (
        <ListSection
          title="Profiles"
          empty="No profiles."
          rows={data.profiles}
          render={(p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 py-2">
              <span className="truncate text-sm text-gray-800">{p.displayName}</span>
              <span className="text-xs text-gray-500">
                {p.lifecycle}
                {p.city ? ` · ${p.city}` : ''}
              </span>
            </div>
          )}
        />
      )}

      {data.businesses.length > 0 && (
        <ListSection
          title="Businesses"
          empty="No businesses."
          rows={data.businesses}
          render={(b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-900">{b.name}</span>
                <span className="text-xs text-gray-500">{b.category}</span>
              </span>
              <span className="pill bg-gray-100 text-gray-600">{b.status.replace(/_/g, ' ')}</span>
            </div>
          )}
        />
      )}

      {data.plannerBusinesses.length > 0 && (
        <ListSection
          title="Business details"
          empty="No agency record."
          rows={data.plannerBusinesses}
          render={(b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-900">{b.name}</span>
                {b.city && <span className="text-xs text-gray-500">{b.city}</span>}
              </span>
              <span className={`pill ${b.isApproved ? 'bg-positive-bg text-positive-fg' : 'bg-caution-bg text-caution-fg'}`}>
                {b.isApproved ? 'Approved' : 'Pending approval'}
              </span>
            </div>
          )}
        />
      )}

      {/* Bookings made *with* a vendor or planner — the list their page is about (EZ1-I172). */}
      {data.providerBookings.length > 0 && (
        <ListSection
          title="Bookings received"
          empty="None."
          rows={data.providerBookings}
          render={(b) => (
            <Link
              key={b.id}
              to={`/admin/bookings/${b.id}`}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-brand-soft/40"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-900">
                  {b.buyerName ?? 'Customer'}
                  {b.serviceName ? ` · ${b.serviceName}` : ''}
                </span>
                <span className="text-xs text-gray-500">
                  {b.eventDate ?? formatDate(b.createdAt)} · #{b.id.slice(0, 8)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium tabular-nums text-gray-900">
                  {b.currency === 'INR' ? '₹' : `${b.currency} `}
                  {Number(b.amount).toLocaleString('en-IN')}
                </span>
                <span className="pill bg-brand-soft text-brand-strong">
                  {BOOKING_STATUS_LABEL[b.status] ?? b.status}
                </span>
              </span>
            </Link>
          )}
        />
      )}

      {data.bookings.length > 0 && (
        <ListSection
          title="Bookings placed"
          empty="No bookings."
          rows={data.bookings}
          render={(b) => (
            <Link
              key={b.id}
              to={`/admin/bookings/${b.id}`}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-brand-soft/40"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium tabular-nums text-gray-900">
                  {b.currency === 'INR' ? '₹' : `${b.currency} `}
                  {Number(b.amount).toLocaleString('en-IN')}
                </span>
                <span className="text-xs text-gray-500">
                  {b.eventDate ?? formatDate(b.createdAt)} · #{b.id.slice(0, 8)}
                </span>
              </span>
              <span className="pill bg-brand-soft text-brand-strong">
                {BOOKING_STATUS_LABEL[b.status] ?? b.status}
              </span>
            </Link>
          )}
        />
      )}

      {(kind === 'officer' ? data.officer?.queue ?? [] : data.verifications).length > 0 && (
        <ListSection
          title={kind === 'officer' ? 'Assigned verification cases' : 'Verification'}
          empty="Nothing here."
          rows={kind === 'officer' ? data.officer?.queue ?? [] : data.verifications}
          render={(v) => (
            <div key={v.id} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-gray-800">
                {v.applicantType} · #{v.id.slice(0, 8)}
              </span>
              <span className="pill bg-gray-100 text-gray-600">{v.status.replace(/_/g, ' ')}</span>
            </div>
          )}
        />
      )}

      {(data.casesRaised.length > 0 || data.casesAssigned.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.casesRaised.length > 0 && (
            <ListSection
              title="Cases raised"
              empty="None."
              rows={data.casesRaised}
              render={(c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate text-sm text-gray-800">{c.title}</span>
                  <span className="pill bg-gray-100 text-gray-600">{c.status.replace(/_/g, ' ')}</span>
                </div>
              )}
            />
          )}
          {data.casesAssigned.length > 0 && (
            <ListSection
              title="Cases assigned"
              empty="None."
              rows={data.casesAssigned}
              render={(c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate text-sm text-gray-800">{c.title}</span>
                  <span className="pill bg-gray-100 text-gray-600">{c.status.replace(/_/g, ' ')}</span>
                </div>
              )}
            />
          )}
        </div>
      )}

      {data.payments.history.length > 0 && (
        <ListSection
          title="Recent payments"
          empty="None."
          rows={data.payments.history}
          render={(p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-gray-600">
                {formatDate(p.createdAt)} · <span className="capitalize">{p.milestone.replace(/_/g, ' ')}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="font-medium tabular-nums text-gray-900">{money(p.amount)}</span>
                <span className="pill bg-gray-100 text-gray-600">{p.status.replace(/_/g, ' ')}</span>
              </span>
            </div>
          )}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2 className="section-title mb-2">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="truncate text-right font-medium text-gray-900">{children}</span>
    </div>
  );
}

function ListSection<T>({
  title,
  rows,
  render,
  empty,
}: {
  title: string;
  rows: T[];
  render: (row: T) => React.ReactNode;
  empty: string;
}) {
  return (
    <div className="card">
      <h2 className="section-title mb-1">{title}</h2>
      {rows.length === 0 ? (
        <p className="py-2 text-sm text-gray-400">{empty}</p>
      ) : (
        <div className="divide-y">{rows.map(render)}</div>
      )}
    </div>
  );
}
