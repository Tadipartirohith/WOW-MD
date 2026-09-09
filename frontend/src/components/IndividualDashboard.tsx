import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { usePermissions } from '../store/auth';
import { Permission, PermissionValue, canAny } from '../lib/permissions';
import { formatDate } from '../lib/dates';
import { UNREAD_POLL_MS, type Notification } from '../lib/notification-copy';
import { Progress, QuickAction, RecentNotifications, Stat } from './IndividualDashboardParts';
import AgentReviewCard from './AgentReviewCard';

/**
 * The individual couple's home screen.
 *
 * Everything here is a live number or list pulled from the module it belongs to
 * — matches, interests, chat, events, bookings, the wedding plan, the honeymoon
 * — never a placeholder. A card the account cannot reach (no permission for
 * that module) is not rendered rather than shown empty, and a module the
 * account can reach but has not used yet shows an honest empty state.
 *
 * Real-time without sockets (EZ1-I150): every query refetches on mount, on
 * window focus and on an interval, so coming back to this tab shows the current
 * figures. Reading a notification here invalidates the same keys the sidebar
 * badge reads, so the two never disagree.
 */
export default function IndividualDashboard() {
  const permissions = usePermissions();
  const has = (...p: PermissionValue[]) => canAny(permissions, p);

  const canMatch = has(Permission.MATCH_BROWSE);
  const canChat = has(Permission.CHAT_INQUIRE, Permission.CHAT_MATCH);
  const canEvents = has(Permission.EVENT_MANAGE_OWN);
  const canBookOwn = has(Permission.BOOKING_READ_OWN);
  const canBook = has(Permission.BOOKING_CREATE);
  const canPlan = has(Permission.PLAN_MANAGE_OWN);
  const canTravel = has(Permission.TRAVEL_BOOK);
  const canProfile = has(Permission.PROFILE_MANAGE_OWN);

  // Poll while open, refresh on focus, and never serve a stale figure on
  // navigation back to the dashboard.
  const live = {
    retry: false as const,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  };

  // Shared with the parent dashboard's ['me'] query, so this reuses that cache.
  const { data: profile } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
    retry: false,
  });
  const profileId: string | undefined = profile?.id;

  const { data: completion } = useQuery({
    queryKey: ['profile-completion', profileId],
    queryFn: async () =>
      (await api.get(`/profiles/${profileId}/details/completion`)).data as {
        percent: number;
        complete: boolean;
        missing: string[];
      },
    enabled: canProfile && Boolean(profileId),
    ...live,
  });

  const { data: matches } = useQuery({
    queryKey: ['dash-suggestions-count'],
    queryFn: async () =>
      (await api.get('/matches/suggestions', { params: { limit: 1 } })).data as {
        meta: { total: number };
      },
    enabled: canMatch,
    ...live,
  });

  const { data: interests } = useQuery({
    queryKey: ['dash-interests'],
    queryFn: async () =>
      (await api.get('/matches/interests')).data as {
        counts: { received: number; accepted: number };
      },
    enabled: canMatch,
    ...live,
  });

  const { data: shortlist } = useQuery({
    queryKey: ['dash-shortlist'],
    queryFn: async () => (await api.get('/matches/shortlist')).data as unknown[],
    enabled: canMatch,
    ...live,
  });

  // No dedicated unread endpoint: the count lives per conversation.
  const { data: conversations } = useQuery({
    queryKey: ['dash-conversations'],
    queryFn: async () =>
      (await api.get('/chat/conversations')).data as { unread: number }[],
    enabled: canChat,
    ...live,
  });
  const unreadMessages = (conversations ?? []).reduce((n, c) => n + (c.unread ?? 0), 0);

  const { data: upcomingEvents } = useQuery({
    queryKey: ['dash-upcoming-events'],
    queryFn: async () =>
      (await api.get('/events', { params: { status: 'upcoming' } })).data as EventRow[],
    enabled: canEvents,
    ...live,
  });

  const { data: bookingCounts } = useQuery({
    queryKey: ['my-booking-counts'],
    queryFn: async () =>
      (await api.get('/bookings/counts')).data as {
        all: number;
        active: number;
        cancelled: number;
        completed: number;
      },
    enabled: canBookOwn,
    ...live,
  });

  // One list serves two cards: the upcoming-bookings preview and the derived
  // planner-engagement status (there is no single planner-status endpoint).
  const { data: bookingsPage } = useQuery({
    queryKey: ['dash-bookings'],
    queryFn: async () =>
      (await api.get('/bookings', { params: { limit: 50 } })).data as { data: BookingRow[] },
    enabled: canBookOwn,
    ...live,
  });
  const bookings = bookingsPage?.data ?? [];
  const upcomingBookings = bookings.filter(
    (b) => b.status !== 'cancelled' && b.status !== 'completed',
  );
  const plannerStatus = derivePlannerStatus(bookings);

  const { data: itineraries } = useQuery({
    queryKey: ['itineraries'],
    queryFn: async () => (await api.get('/travel/itineraries')).data as { id: string; title: string }[],
    enabled: canTravel,
    ...live,
  });

  const { data: wedding } = useQuery({
    queryKey: ['wedding-dashboard'],
    queryFn: async () => (await api.get('/planner/dashboard')).data as { journey: { percent: number } },
    enabled: canPlan,
    ...live,
  });
  const planPercent = wedding?.journey?.percent ?? 0;

  const { data: vendorPage } = useQuery({
    queryKey: ['dash-recommended-vendors'],
    queryFn: async () =>
      (await api.get('/vendors/search', { params: { limit: 6 } })).data as { data: VendorRow[] },
    enabled: canBook,
    ...live,
  });
  const vendors = vendorPage?.data ?? [];

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications')).data as Notification[],
    refetchInterval: UNREAD_POLL_MS,
    retry: false,
  });
  const recentNotifications = (notifications ?? []).slice(0, 5);

  return (
    <div className="space-y-10">
      {/* The numbers a couple opens the app for, each opening its own module. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {canMatch && (
          <Stat label="New matches" value={matches?.meta?.total ?? 0} to="/matches" />
        )}
        {canMatch && (
          <Stat
            label="Interests received"
            value={interests?.counts?.received ?? 0}
            to="/interests"
            tone={(interests?.counts?.received ?? 0) > 0 ? 'text-amber-700' : undefined}
          />
        )}
        {canChat && (
          <Stat
            label="Unread messages"
            value={unreadMessages}
            to="/chat"
            tone={unreadMessages > 0 ? 'text-amber-700' : undefined}
          />
        )}
        {canMatch && (
          <Stat label="Shortlisted profiles" value={shortlist?.length ?? 0} to="/matches" />
        )}
        {canEvents && (
          <Stat label="Upcoming events" value={upcomingEvents?.length ?? 0} to="/events" />
        )}
        {canBookOwn && (
          <Stat label="Upcoming bookings" value={bookingCounts?.active ?? 0} to="/bookings" />
        )}
        {canTravel && (
          <Stat label="Honeymoon plans" value={itineraries?.length ?? 0} to="/travel" />
        )}
        {canBook && (
          <Stat
            label="Planner status"
            value={plannerStatus.label}
            to="/wedding-planners"
            tone={plannerStatus.tone}
          />
        )}
      </div>

      {/* Progress the couple can act on, worked out from real completion. */}
      {(canProfile || canPlan) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {canProfile && (
            <Progress
              label="Profile completion"
              percent={completion?.percent ?? (profile?.profileCompleted ? 100 : 0)}
              to="/profile"
              hint={
                completion && completion.percent < 100
                  ? `${completion.missing.length} section${completion.missing.length === 1 ? '' : 's'} left`
                  : 'All done'
              }
            />
          )}
          {canPlan && (
            <Progress
              label="My wedding plan"
              percent={planPercent}
              to="/planner"
              hint={planPercent >= 100 ? 'All done' : 'Tasks left to tick off'}
            />
          )}
        </div>
      )}

      {/* The agent who represents this client — rate them (EZ1-I206). Renders
          nothing for a client with no agent. */}
      <AgentReviewCard />

      {/* What is actually coming: events and bookings, side by side. */}
      {(canEvents || canBookOwn) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {canEvents && (
            <div className="card">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="section-title text-sm">Upcoming events</h3>
                <Link className="text-xs text-brand hover:underline" to="/events">
                  All events
                </Link>
              </div>
              {(upcomingEvents ?? []).length === 0 ? (
                <p className="text-sm text-gray-500">
                  Nothing on the calendar yet.{' '}
                  <Link className="text-brand underline" to="/events">
                    Add an event
                  </Link>
                  .
                </p>
              ) : (
                <ul className="divide-y">
                  {upcomingEvents!.slice(0, 5).map((e) => (
                    <li key={e.id} className="py-2">
                      <Link className="block hover:opacity-80" to="/events">
                        <p className="truncate text-sm font-medium text-gray-900">{e.name}</p>
                        <p className="text-xs text-gray-500">
                          {formatDate(e.eventDate)}
                          {e.startTime ? ` · ${e.startTime.slice(0, 5)}` : ''}
                          {e.venue || e.city ? ` · ${e.venue ?? e.city}` : ''}
                          <span className="ml-1 capitalize text-gray-400">· {e.status}</span>
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {canBookOwn && (
            <div className="card">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="section-title text-sm">Upcoming bookings</h3>
                <Link className="text-xs text-brand hover:underline" to="/bookings">
                  All bookings
                </Link>
              </div>
              {upcomingBookings.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No active bookings.{' '}
                  <Link className="text-brand underline" to="/vendors">
                    Find a vendor
                  </Link>
                  .
                </p>
              ) : (
                <ul className="divide-y">
                  {upcomingBookings.slice(0, 5).map((b) => (
                    <li key={b.id} className="py-2">
                      <Link className="block hover:opacity-80" to={`/bookings?highlight=${b.id}`}>
                        <p className="truncate text-sm font-medium text-gray-900">
                          {b.providerName ?? b.serviceName ?? 'Booking'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {b.eventDate ? `${formatDate(b.eventDate)} · ` : ''}
                          <span className="capitalize">{b.status.replace(/_/g, ' ')}</span>
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recent notifications — reading one clears it here and on the sidebar. */}
      <RecentNotifications rows={recentNotifications} />

      {/* Recommended vendors from the live catalogue. */}
      {canBook && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-500">Recommended vendors</h2>
            <Link className="text-xs text-brand hover:underline" to="/vendors">
              Browse all
            </Link>
          </div>
          {vendors.length === 0 ? (
            <p className="card text-sm text-gray-500">No vendors listed yet. Check back soon.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {vendors.map((v) => (
                <Link
                  key={v.id}
                  to={`/vendors/${v.id}`}
                  className="card transition-shadow hover:shadow-card"
                >
                  <p className="truncate font-medium text-gray-900">{v.name}</p>
                  <p className="mt-0.5 text-xs capitalize text-gray-500">
                    {v.category}
                    {v.city ? ` · ${v.city}` : ''}
                    {v.ratingCount > 0 ? ` · ★ ${Number(v.ratingAvg).toFixed(1)}` : ''}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Quick actions — every one navigates. */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-gray-500">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          {canMatch && <QuickAction to="/matches" label="Find matches" />}
          {canBook && <QuickAction to="/wedding-planners" label="Hire a planner" />}
          {canBook && <QuickAction to="/vendors" label="Find vendors" />}
          {canEvents && <QuickAction to="/events" label="Add event" />}
          {has(Permission.MEDIA_MANAGE_OWN) && <QuickAction to="/media" label="Upload media" />}
          {has(Permission.CASE_RAISE) && <QuickAction to="/support" label="Get support" />}
        </div>
      </section>

      {/* Support: raise an issue or read the ones already raised. */}
      {has(Permission.CASE_RAISE) && (
        <section className="card flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="section-title text-sm">Support</h2>
            <p className="text-sm text-gray-500">
              Something gone wrong with a booking, a payment or a listing? Somebody reads every one.
            </p>
          </div>
          <div className="flex gap-2">
            <Link className="btn" to="/support">
              Raise an issue
            </Link>
            <Link className="btn-outline" to="/support">
              View my tickets
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

interface EventRow {
  id: string;
  name: string;
  eventDate: string;
  startTime: string | null;
  venue: string | null;
  city: string | null;
  status: string;
}

interface BookingRow {
  id: string;
  providerType: 'vendor' | 'planner';
  providerName: string | null;
  serviceName: string | null;
  status: string;
  eventDate: string | null;
}

interface VendorRow {
  id: string;
  name: string;
  category: string;
  city: string | null;
  ratingAvg: number;
  ratingCount: number;
}

/**
 * The planner engagement, read off the couple's own bookings against a planner
 * listing (there is no single planner-status endpoint). A live, non-cancelled
 * booking wins over an old cancelled one.
 */
function derivePlannerStatus(bookings: BookingRow[]): { label: string; tone?: string } {
  const planner = bookings.filter((b) => b.providerType === 'planner');
  if (planner.length === 0) return { label: 'Not hired' };
  const chosen = planner.find((b) => b.status !== 'cancelled') ?? planner[0];
  switch (chosen.status) {
    case 'requested':
      return { label: 'Request sent', tone: 'text-amber-700' };
    case 'quotation_sent':
      return { label: 'Quote received', tone: 'text-amber-700' };
    case 'quotation_accepted':
    case 'payment_pending':
    case 'pending':
      return { label: 'Hired', tone: 'text-emerald-700' };
    case 'cancelled':
      return { label: 'Cancelled' };
    default:
      // confirmed / in_progress / completed_pending_final_payment / completed / disputed
      return { label: 'Confirmed', tone: 'text-emerald-700' };
  }
}
