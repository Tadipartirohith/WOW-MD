import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { BOOKING_STATUS_LABEL } from '../../lib/permissions';
import { ActivityFeed } from '../../components/AdminConsole';
import Admin360 from '../../components/Admin360';

interface Analytics {
  totalUsers: number;
  totalVendors: number;
  totalPlanners: number;
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

/**
 * The Admin Portal landing screen (EZ1-I153).
 *
 * Every summary card links to the dedicated page that manages what it counts,
 * with the relevant filter already applied where one exists — the escrow card
 * opens Payments filtered to what is held, not the whole ledger. No card is a
 * dead end; that was the rule the tabbed console was built on and it survives
 * the move to routes.
 */
export default function AdminDashboard() {
  const { data: analytics } = useQuery({
    queryKey: ['analytics'],
    queryFn: async () => (await api.get('/admin/analytics')).data as Analytics,
    retry: false,
  });

  const cards: { label: string; value: number | string; to: string }[] = analytics
    ? [
        { label: 'Users', value: analytics.totalUsers, to: '/admin/users' },
        { label: 'Agents', value: analytics.totalAgents, to: '/admin/agents' },
        { label: 'Vendors', value: analytics.totalVendors, to: '/admin/vendors' },
        { label: 'Planners', value: analytics.totalPlanners, to: '/admin/planners' },
        { label: 'Bookings', value: analytics.totalBookings, to: '/admin/bookings' },
        { label: 'Awaiting verification', value: analytics.verification.awaitingAllocation, to: '/verification' },
        { label: 'Open cases', value: analytics.verification.casesOpen, to: '/verification' },
        { label: 'Open disputes', value: analytics.openDisputes, to: '/verification' },
        {
          label: 'Held in escrow',
          value: `₹${Number(analytics.escrow?.bookings?.held ?? 0).toLocaleString('en-IN')}`,
          to: '/admin/payments?status=held_in_escrow',
        },
        { label: 'Payments', value: analytics.totalBookings, to: '/admin/payments' },
      ]
    : [];

  return (
    <div className="space-y-6">
      <h1 className="page-title">Admin</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {cards.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            className="card text-center transition-colors hover:border-gray-300"
          >
            <p className="page-title">{c.value}</p>
            <p className="text-xs text-gray-500">{c.label}</p>
          </Link>
        ))}
      </div>

      {/*
        The lookup goes first. It is the thing an administrator opens this page
        holding — a support ticket with a uuid in it — and everything below is
        the platform in aggregate, which is a different question.
      */}
      <Admin360 />

      <ActivityFeed />

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
          <h2 className="section-title mb-2">Bookings by stage</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(analytics.bookingsByStatus)
              .filter(([, count]) => count > 0)
              .map(([status, count]) => (
                <Link
                  key={status}
                  to={`/admin/bookings?status=${status}`}
                  className="rounded-full bg-gray-100 px-3 py-1 text-sm transition-colors hover:bg-gray-200"
                >
                  {BOOKING_STATUS_LABEL[status] ?? status}: <strong>{count}</strong>
                </Link>
              ))}
          </div>
        </div>
      )}

      {analytics?.usersByRole && (
        <div className="card">
          <h2 className="section-title mb-2">Accounts by type</h2>
          <div className="flex flex-wrap gap-2">
            {analytics.usersByRole.map((r) => (
              <span key={r.role} className="rounded-full bg-gray-100 px-3 py-1 text-sm">
                {r.role}: <strong>{r.count}</strong>
              </span>
            ))}
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
      <h2 className="section-title">{title}</h2>
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
