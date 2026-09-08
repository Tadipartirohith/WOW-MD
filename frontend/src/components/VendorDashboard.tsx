import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  CalendarBlank,
  CalendarCheck,
  Coins,
  Lifebuoy,
  Receipt,
  Star,
  Storefront,
} from '@phosphor-icons/react';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { useBusinesses } from '../store/business';
import { BOOKING_STATUS_LABEL } from '../lib/permissions';
import { formatShortDate, daysAway } from '../lib/dates';
import { Loading } from './ui/Feedback';
import GetStarted from './GetStarted';
import BookingsOverviewChart from './BookingsOverviewChart';
import {
  BUSINESS_STATUS_LABEL,
  BookingList,
  IncomingBooking,
  QuickAction,
  StatCard,
  greeting,
  rupees,
} from './VendorDashboardParts';

/**
 * The vendor's home screen (EZ1-I147).
 *
 * Every figure on it is read live from the same endpoints the rest of the
 * provider console uses — booking counts, the escrow ledger, the reviews
 * aggregate, availability, notifications — so nothing here is hardcoded and a
 * vendor only ever sees their own account: each endpoint scopes to the listings
 * the caller owns on the server. "Real-time" is refetch-on-focus plus a poll
 * plus the invalidations the booking actions already fire; this app has no
 * socket for it, and this does not pretend otherwise.
 */

interface Earnings {
  heldInEscrow: string;
  pendingPayout: string;
  released: string;
  currency: string;
  ledger: {
    status: string;
    payoutAmount: string;
    confirmedAt: string | null;
    createdAt: string;
  }[];
}

interface VendorRow {
  id: string;
  ratingAvg: number;
  ratingCount: number;
}

/** Where each business status stands, said in words rather than an enum value. */
const STATUS_TONE: Record<string, string> = {
  live: 'bg-emerald-50 text-emerald-800',
  verified: 'bg-emerald-50 text-emerald-800',
  rejected: 'bg-red-50 text-red-800',
  reverification_required: 'bg-amber-50 text-amber-800',
};

/** Which console tab a status card should open the queue on. */
const TAB_FOR = {
  requested: 'requests',
  completed: 'completed',
  cancelled: 'cancelled',
  active: 'all',
} as const;

/** In-flight: everything that is neither finished nor called off. */
const CLOSED = ['completed', 'cancelled', 'disputed'];

export default function VendorDashboard() {
  const profile = useAuth((s) => s.user);
  const { active, businesses, activeId } = useBusinesses();

  // Poll while open and refetch when the tab regains focus, so a new request or
  // a released payout appears without a manual refresh (EZ1-I147).
  const live = {
    retry: false,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  };

  const counts = useQuery({
    queryKey: ['incoming-counts'],
    queryFn: async () => (await api.get('/bookings/incoming/counts')).data as Record<string, number>,
    ...live,
  });

  const earnings = useQuery({
    queryKey: ['earnings'],
    queryFn: async () => (await api.get('/bookings/earnings')).data as Earnings,
    ...live,
  });

  const incoming = useQuery({
    queryKey: ['incoming-bookings'],
    queryFn: async () =>
      (await api.get('/bookings/incoming', { params: { limit: 100 } })).data as {
        data: IncomingBooking[];
      },
    ...live,
  });

  const unread = useQuery({
    queryKey: ['unread-count'],
    queryFn: async () => (await api.get('/notifications/unread-count')).data as { unread: number },
    ...live,
  });

  const vendorRows = useQuery({
    queryKey: ['vendor-me'],
    queryFn: async () => (await api.get('/vendors/me')).data as VendorRow[],
    retry: false,
  });

  const slots = useQuery({
    queryKey: ['availability-summary', activeId],
    queryFn: async () =>
      (await api.get(`/vendors/${activeId}/availability/summary`)).data as { openSlots: number },
    enabled: Boolean(activeId),
    refetchOnMount: 'always',
    retry: false,
  });

  const c = counts.data ?? {};
  const all = c.all ?? 0;
  const completed = c.completed ?? 0;
  const cancelled = c.cancelled ?? 0;
  const requested = c.requested ?? 0;
  const activeCount = Math.max(0, all - completed - cancelled);

  const bookings = incoming.data?.data ?? [];
  const activeBookings = bookings.filter((b) => !CLOSED.includes(b.status));
  const recent = [...bookings]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);
  const upcoming = bookings
    .filter((b) => {
      const d = daysAway(b.eventDate);
      return d !== null && d >= 0;
    })
    .sort((a, b) => (a.eventDate ?? '').localeCompare(b.eventDate ?? ''))
    .slice(0, 5);

  // This month's earnings, from the escrow ledger: released payouts confirmed
  // (or, failing a confirmation timestamp, created) in the current month.
  const now = new Date();
  const thisMonth = (earnings.data?.ledger ?? []).reduce((sum, p) => {
    if (p.status !== 'released') return sum;
    const d = new Date(p.confirmedAt ?? p.createdAt);
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
      return sum + Number(p.payoutAmount || 0);
    }
    return sum;
  }, 0);

  const activeRow = vendorRows.data?.find((v) => v.id === activeId);
  const ratingAvg = activeRow?.ratingAvg ?? 0;
  const ratingCount = activeRow?.ratingCount ?? 0;

  const failed = counts.isError || earnings.isError || incoming.isError;
  const firstName = (profile?.email ?? '').split('@')[0];

  return (
    <div className="space-y-8">
      {/* A vendor with no live listing yet is nudged to finish it first. */}
      <GetStarted />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-gray-500">{greeting()}{firstName ? `, ${firstName}` : ''}</p>
          <h1 className="page-title mt-1">
            {active ? active.name : 'My Business'}
          </h1>
          {active && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  STATUS_TONE[active.status] ?? 'bg-amber-50 text-amber-800'
                }`}
              >
                {active.isApproved ? 'Live in search' : (BUSINESS_STATUS_LABEL[active.status] ?? active.status.replace(/_/g, ' '))}
              </span>
              {businesses.length > 1 && (
                <span className="text-xs text-gray-400">
                  {businesses.length} businesses · switch from the header
                </span>
              )}
            </div>
          )}
        </div>
        <Link className="btn-outline shrink-0" to="/console">
          Manage business
        </Link>
      </header>

      {failed && (
        <p className="alert-critical">
          Some of your dashboard could not be loaded. It will refresh on its own, or reload the page.
        </p>
      )}

      {/* Booking summary — each card opens the queue filtered to it. */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-gray-500">Bookings</h2>
        {counts.isLoading ? (
          <Loading rows={2} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total bookings" value={all} to="/bookings?tab=all" />
            <StatCard
              label="New requests"
              value={requested}
              to={`/bookings?tab=${TAB_FOR.requested}`}
              tone={requested > 0 ? 'text-amber-700' : undefined}
            />
            <StatCard label="Completed" value={completed} to={`/bookings?tab=${TAB_FOR.completed}`} />
            <StatCard label="Cancelled" value={cancelled} to={`/bookings?tab=${TAB_FOR.cancelled}`} />
          </div>
        )}
      </section>

      {/* Money — earnings this month and what is still owed, into the ledger. */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-gray-500">Money</h2>
        {earnings.isLoading ? (
          <Loading rows={2} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Earnings this month" value={rupees(thisMonth)} to="/accounts" icon={Coins} />
            <StatCard
              label="Held in escrow"
              value={rupees(earnings.data?.heldInEscrow ?? 0)}
              to="/accounts"
            />
            <StatCard
              label="Pending payouts"
              value={rupees(earnings.data?.pendingPayout ?? 0)}
              to="/accounts"
              tone={Number(earnings.data?.pendingPayout ?? 0) > 0 ? 'text-amber-700' : undefined}
            />
            <StatCard label="Total paid out" value={rupees(earnings.data?.released ?? 0)} to="/accounts" />
          </div>
        )}
      </section>

      {/* Rating, open windows and unread notifications — three at-a-glance stats. */}
      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Average rating"
          value={ratingCount > 0 ? `${ratingAvg.toFixed(1)} ★` : 'No reviews'}
          hint={ratingCount > 0 ? `${ratingCount} review${ratingCount === 1 ? '' : 's'}` : 'Arrive with completed jobs'}
          to="/my-reviews"
          icon={Star}
        />
        <StatCard
          label="Active bookings"
          value={activeCount}
          to={`/bookings?tab=${TAB_FOR.active}`}
          icon={Receipt}
        />
        <StatCard
          label="Unread notifications"
          value={unread.data?.unread ?? 0}
          to="/notifications"
          icon={Bell}
          tone={(unread.data?.unread ?? 0) > 0 ? 'text-amber-700' : undefined}
        />
      </section>

      {/* Bookings over a selectable period, drawn from the real request dates. */}
      {incoming.isLoading ? (
        <div className="card">
          <Loading rows={3} />
        </div>
      ) : (
        <BookingsOverviewChart bookings={bookings} />
      )}

      {/* Status breakdown — the whole queue by state, each row into that tab. */}
      <section className="card space-y-3">
        <h2 className="section-title">Booking status</h2>
        {counts.isLoading ? (
          <Loading rows={3} />
        ) : all === 0 ? (
          <p className="text-sm text-gray-400">No bookings against your listings yet.</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(BOOKING_STATUS_LABEL)
              .filter(([status]) => (c[status] ?? 0) > 0)
              .map(([status, label]) => (
                <div key={status} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-sm text-gray-600">{label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className="h-full rounded-full bg-brand"
                      style={{ width: `${((c[status] ?? 0) / all) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right font-mono text-sm tabular-nums text-gray-800">
                    {c[status] ?? 0}
                  </span>
                </div>
              ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Active bookings — the jobs currently in flight. */}
        <BookingList
          title="Active bookings"
          icon={Receipt}
          bookings={activeBookings}
          loading={incoming.isLoading}
          empty="Nothing in flight right now."
        />
        {/* Recent bookings — most recently requested, whatever their state. */}
        <BookingList
          title="Recent bookings"
          icon={CalendarBlank}
          bookings={recent}
          loading={incoming.isLoading}
          empty="No bookings yet."
        />
      </div>

      {/* Upcoming bookings & events, by wedding date. */}
      <section className="card space-y-3">
        <div className="flex items-center gap-2">
          <CalendarCheck size={18} className="text-gray-400" aria-hidden />
          <h2 className="section-title">Upcoming bookings & events</h2>
        </div>
        {incoming.isLoading ? (
          <Loading rows={3} />
        ) : upcoming.length === 0 ? (
          <p className="text-sm text-gray-400">No dated bookings coming up.</p>
        ) : (
          <ul className="divide-y divide-gray-200">
            {upcoming.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {b.clientName ?? 'Customer'}
                    {b.serviceName && <span className="font-normal text-gray-500"> · {b.serviceName}</span>}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {[b.eventName, [b.eventVenue, b.eventCity].filter(Boolean).join(', ') || null]
                      .filter(Boolean)
                      .join(' · ') || BOOKING_STATUS_LABEL[b.status] || b.status}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-gray-500">{formatShortDate(b.eventDate)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Quick actions — every one navigates to the module that owns it. */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-gray-500">Quick actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickAction to="/bookings" icon={Receipt} label="View bookings" />
          <QuickAction to="/availability" icon={CalendarBlank} label="Update availability" hint={slots.data ? `${slots.data.openSlots} open windows` : undefined} />
          <QuickAction to="/console" icon={Storefront} label="Manage business" />
          <QuickAction to="/accounts" icon={Coins} label="View earnings" />
          <QuickAction to="/my-reviews" icon={Star} label="Respond to reviews" />
          <QuickAction to="/support" icon={Lifebuoy} label="Contact support" />
        </div>
      </section>
    </div>
  );
}
