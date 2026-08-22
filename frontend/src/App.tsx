import { Navigate, Route, Routes, Link, useLocation, useNavigate } from 'react-router-dom';
import { ReactNode, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './store/auth';
import { api, bootstrapSession } from './lib/api';
import { Permission, PermissionValue, ROLE_LABEL, UserRole, canAny } from './lib/permissions';
import Login from './pages/Login';
import Register from './pages/Register';
import AcceptInvite from './pages/AcceptInvite';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import GuestRsvp from './pages/GuestRsvp';
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import Matches from './pages/Matches';
import Vendors from './pages/Vendors';
import Planner from './pages/Planner';
import Chat from './pages/Chat';
import Bookings from './pages/Bookings';
import Genie from './pages/Genie';
import Events from './pages/Events';
import Travel from './pages/Travel';
import Media from './pages/Media';
import Admin from './pages/Admin';
import SharedAlbum from './pages/SharedAlbum';
import AgentClients from './pages/AgentClients';
import ManagedProfiles from './pages/ManagedProfiles';
import SharedWithMe from './pages/SharedWithMe';
import NetworkPool from './pages/NetworkPool';
import Proposals from './pages/Proposals';
import SharedBiodata from './pages/SharedBiodata';
import Agency from './pages/Agency';
import Security from './pages/Security';
import ProviderConsole from './pages/ProviderConsole';
import WeddingPlanners from './pages/WeddingPlanners';
import Forbidden from './pages/Forbidden';
import Verification from './pages/Verification';
import SetPassword from './pages/SetPassword';
import Availability from './pages/Availability';
import Accounts from './pages/Accounts';
import Notifications from './pages/Notifications';
import Biodata from './pages/Biodata';

/**
 * Every nav entry declares the capabilities it needs. A user sees an entry only
 * if they hold at least one of them, which is what keeps a vendor from being
 * shown Matches or a bride from being shown the Admin console.
 */
interface NavEntry {
  to: string;
  label: string;
  requires: PermissionValue[];
}

const NAV: NavEntry[] = [
  { to: '/', label: 'Dashboard', requires: [] },
  { to: '/matches', label: 'Matches', requires: [Permission.MATCH_BROWSE] },
  {
    to: '/biodata',
    label: 'Biodata',
    requires: [Permission.MATCH_BROWSE, Permission.MANAGED_PROFILE_MANAGE],
  },
  { to: '/chat', label: 'Chat', requires: [Permission.CHAT_INQUIRE, Permission.CHAT_MATCH] },
  {
    to: '/client-profiles',
    label: 'Client Profiles',
    requires: [Permission.MANAGED_PROFILE_MANAGE],
  },
  { to: '/shared-with-me', label: 'Shared With Me', requires: [Permission.ACT_ON_BEHALF] },
  { to: '/pool', label: 'Network Pool', requires: [Permission.NETWORK_POOL_BROWSE] },
  { to: '/proposals', label: 'Proposals', requires: [Permission.ACT_ON_BEHALF] },
  { to: '/clients', label: 'My Clients', requires: [Permission.CLIENT_READ] },
  { to: '/agency', label: 'My Agency', requires: [Permission.AGENCY_MANAGE] },
  { to: '/vendors', label: 'Vendors', requires: [Permission.BOOKING_CREATE] },
  { to: '/wedding-planners', label: 'Planners', requires: [Permission.BOOKING_CREATE] },
  {
    to: '/console',
    label: 'My Business',
    requires: [Permission.VENDOR_LISTING_MANAGE, Permission.PLANNER_LISTING_MANAGE],
  },
  { to: '/availability', label: 'Availability', requires: [Permission.VENDOR_LISTING_MANAGE] },
  { to: '/accounts', label: 'Accounts', requires: [Permission.BOOKING_READ_INCOMING] },
  {
    to: '/planner',
    label: 'Planner',
    requires: [Permission.PLAN_MANAGE_OWN, Permission.PLAN_MANAGE_ENGAGED],
  },
  {
    to: '/bookings',
    label: 'Bookings',
    requires: [Permission.BOOKING_READ_OWN, Permission.BOOKING_READ_INCOMING],
  },
  { to: '/events', label: 'Events', requires: [Permission.EVENT_MANAGE_OWN] },
  { to: '/travel', label: 'Honeymoon', requires: [Permission.TRAVEL_BOOK] },
  { to: '/media', label: 'Media', requires: [Permission.MEDIA_MANAGE_OWN] },
  { to: '/genie', label: 'WOW Genie', requires: [Permission.AI_ASSIST] },
  {
    to: '/verification',
    label: 'Verification',
    requires: [Permission.VERIFICATION_PROCESS, Permission.VERIFICATION_ALLOCATE],
  },
  { to: '/notifications', label: 'Notifications', requires: [] },
  // Security sits in the navigation rather than under the email dropdown:
  // sessions, two-factor and recovery codes are things people go looking for,
  // and a menu they have to discover first is a menu they never open.
  { to: '/security', label: 'Security', requires: [] },
  { to: '/admin', label: 'Admin', requires: [Permission.ADMIN_ANALYTICS_READ] },
];

/**
 * The unread count, shown on the Notifications tab.
 *
 * There used to be a bell here as well as the tab, which meant two controls
 * for one thing and a count that could be a minute apart between them. The tab
 * won: it is where the whole feed lives, and a badge on it says the same thing
 * the bell did.
 *
 * Polled rather than pushed: the count is a single indexed count query, and a
 * socket that has to survive sleeping laptops and flaky mobile networks is a
 * lot of machinery for a number that can be a minute stale without anybody
 * being worse off.
 */
function useUnreadCount(): number {
  const { data } = useQuery({
    queryKey: ['unread-count'],
    queryFn: async () => (await api.get('/notifications/unread-count')).data,
    refetchInterval: 60_000,
    retry: false,
  });
  return data?.unread ?? 0;
}

/**
 * The email dropdown.
 *
 * My Profile and Security live here rather than in the main navigation: they
 * are about the account, not about the work, and a vendor scanning the bar for
 * their bookings should not have to read past them.
 */
function AccountMenu({
  email,
  role,
  onSignOut,
}: {
  email?: string;
  role?: UserRole;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  // Any navigation closes it, including a click on one of its own entries.
  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 rounded px-2 py-1 text-left hover:bg-gray-100"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="hidden sm:block">
          <span className="block text-sm text-gray-700">{email}</span>
          <span className="block text-xs text-gray-400">
            {role ? (ROLE_LABEL[role] ?? role) : ''}
          </span>
        </span>
        <span className="text-gray-400">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <>
          {/* Click-away. A bare document listener would fight the toggle above. */}
          <button
            className="fixed inset-0 z-10 cursor-default"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded border border-gray-200 bg-white shadow-lg"
          >
            <Link className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" to="/profile">
              My Profile
            </Link>
            <button
              className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              onClick={onSignOut}
            >
              Logout
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Layout({ children }: { children: ReactNode }) {
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);
  const setPermissions = useAuth((s) => s.setPermissions);
  const nav = useNavigate();
  const loc = useLocation();

  // Refresh capabilities on mount so a role or entitlement change on the server
  // is reflected without the user having to sign out and back in.
  useEffect(() => {
    let cancelled = false;
    api
      .get('/auth/me/permissions')
      .then(({ data }) => {
        if (!cancelled) setPermissions(data.permissions);
      })
      .catch(() => {
        /* 401 is already handled by the axios interceptor */
      });
    return () => {
      cancelled = true;
    };
  }, [setPermissions]);

  async function signOut() {
    // Clears the httpOnly refresh cookie and revokes the session server-side.
    await api.post('/auth/logout', {}).catch(() => undefined);
    clear();
    nav('/login');
  }

  const permissions = user?.permissions ?? [];
  const visible = NAV.filter((n) => n.requires.length === 0 || canAny(permissions, n.requires));
  const unread = useUnreadCount();

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link to="/" className="text-xl font-bold text-brand">
            WOW
          </Link>
          <nav className="hidden gap-1 md:flex md:flex-wrap">
            {visible.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`rounded px-3 py-1.5 text-sm ${
                  loc.pathname === n.to
                    ? 'bg-brand-light text-brand-dark'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {n.label}
                {n.to === '/notifications' && unread > 0 && (
                  <span
                    className="ml-1.5 inline-block min-w-[18px] rounded-full bg-brand px-1 text-center text-[10px] font-semibold leading-[18px] text-white"
                    aria-label={`${unread} unread`}
                  >
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <AccountMenu email={user?.email} role={user?.role} onSignOut={signOut} />
          </div>
        </div>
      </header>

      {user && !user.isVerified && (
        <div className="border-b border-amber-200 bg-amber-50">
          <div className="mx-auto max-w-6xl px-4 py-2 text-sm text-amber-900">
            Please confirm your email address.{' '}
            <Link className="underline" to="/security">
              Resend the confirmation
            </Link>
            .
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}

/**
 * Route guard. `requires` mirrors the server-side permission on the matching
 * endpoints; the server still enforces it, this just avoids rendering a page
 * that would only produce 403s.
 */
function Protected({
  children,
  requires = [],
}: {
  children: ReactNode;
  requires?: PermissionValue[];
}) {
  const token = useAuth((s) => s.accessToken);
  const ready = useAuth((s) => s.ready);
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const mustResetPassword = useAuth((s) => s.user?.mustResetPassword ?? false);

  // Tokens are held in memory now, so a reload has nothing until the silent
  // refresh finishes. Waiting here stops a signed-in user being bounced to
  // /login for a frame on every page load.
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }
  if (!token) return <Navigate to="/login" replace />;

  // An account still holding an emailed temporary password can reach exactly
  // one screen. The server enforces this; sending them there directly saves
  // them a wall of refusals on the way to the same place.
  if (mustResetPassword) return <Navigate to="/set-password" replace />;

  if (requires.length > 0 && !canAny(permissions, requires)) {
    return (
      <Layout>
        <Forbidden />
      </Layout>
    );
  }
  return <Layout>{children}</Layout>;
}

export default function App() {
  // Restore the session from the httpOnly refresh cookie, once, on start-up.
  useEffect(() => {
    void bootstrapSession();
  }, []);

  return (
    <Routes>
      {/* Public, token-addressed entry points. */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/invite/:token" element={<AcceptInvite />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />
      <Route path="/verify-email/:token" element={<VerifyEmail />} />
      <Route path="/rsvp/:token" element={<GuestRsvp />} />
      <Route path="/biodata/:token" element={<SharedBiodata />} />
      <Route path="/album/:token" element={<SharedAlbum />} />

      {/* Signed in, but locked to the password reset. Deliberately outside
          Protected, which would bounce straight back here. */}
      <Route path="/set-password" element={<SetPassword />} />

      <Route
        path="/"
        element={
          <Protected>
            <Dashboard />
          </Protected>
        }
      />
      <Route
        path="/profile"
        element={
          <Protected requires={[Permission.PROFILE_MANAGE_OWN]}>
            <Profile />
          </Protected>
        }
      />
      <Route
        path="/security"
        element={
          <Protected requires={[Permission.SESSION_MANAGE_OWN]}>
            <Security />
          </Protected>
        }
      />
      <Route
        path="/verification"
        element={
          <Protected requires={[Permission.VERIFICATION_PROCESS, Permission.VERIFICATION_ALLOCATE]}>
            <Verification />
          </Protected>
        }
      />
      <Route
        path="/matches"
        element={
          <Protected requires={[Permission.MATCH_BROWSE]}>
            <Matches />
          </Protected>
        }
      />
      <Route
        path="/client-profiles"
        element={
          <Protected requires={[Permission.MANAGED_PROFILE_MANAGE]}>
            <ManagedProfiles />
          </Protected>
        }
      />
      <Route
        path="/shared-with-me"
        element={
          <Protected requires={[Permission.ACT_ON_BEHALF]}>
            <SharedWithMe />
          </Protected>
        }
      />
      <Route
        path="/pool"
        element={
          <Protected requires={[Permission.NETWORK_POOL_BROWSE]}>
            <NetworkPool />
          </Protected>
        }
      />
      <Route
        path="/proposals"
        element={
          <Protected requires={[Permission.ACT_ON_BEHALF]}>
            <Proposals />
          </Protected>
        }
      />
      <Route
        path="/clients"
        element={
          <Protected requires={[Permission.CLIENT_READ]}>
            <AgentClients />
          </Protected>
        }
      />
      <Route
        path="/agency"
        element={
          <Protected requires={[Permission.AGENCY_MANAGE]}>
            <Agency />
          </Protected>
        }
      />
      <Route
        path="/vendors"
        element={
          <Protected requires={[Permission.BOOKING_CREATE]}>
            <Vendors />
          </Protected>
        }
      />
      <Route
        path="/wedding-planners"
        element={
          <Protected requires={[Permission.BOOKING_CREATE]}>
            <WeddingPlanners />
          </Protected>
        }
      />
      <Route
        path="/console"
        element={
          <Protected
            requires={[Permission.VENDOR_LISTING_MANAGE, Permission.PLANNER_LISTING_MANAGE]}
          >
            <ProviderConsole />
          </Protected>
        }
      />
      <Route
        path="/planner"
        element={
          <Protected requires={[Permission.PLAN_MANAGE_OWN, Permission.PLAN_MANAGE_ENGAGED]}>
            <Planner />
          </Protected>
        }
      />
      <Route
        path="/chat"
        element={
          <Protected requires={[Permission.CHAT_INQUIRE, Permission.CHAT_MATCH]}>
            <Chat />
          </Protected>
        }
      />
      <Route
        path="/bookings"
        element={
          <Protected requires={[Permission.BOOKING_READ_OWN, Permission.BOOKING_READ_INCOMING]}>
            <Bookings />
          </Protected>
        }
      />
      <Route
        path="/events"
        element={
          <Protected requires={[Permission.EVENT_MANAGE_OWN]}>
            <Events />
          </Protected>
        }
      />
      <Route
        path="/travel"
        element={
          <Protected requires={[Permission.TRAVEL_BOOK]}>
            <Travel />
          </Protected>
        }
      />
      <Route
        path="/media"
        element={
          <Protected requires={[Permission.MEDIA_MANAGE_OWN]}>
            <Media />
          </Protected>
        }
      />
      <Route
        path="/genie"
        element={
          <Protected requires={[Permission.AI_ASSIST]}>
            <Genie />
          </Protected>
        }
      />
      <Route
        path="/biodata"
        element={
          <Protected requires={[Permission.MATCH_BROWSE, Permission.MANAGED_PROFILE_MANAGE]}>
            <Biodata />
          </Protected>
        }
      />
      <Route
        path="/availability"
        element={
          <Protected requires={[Permission.VENDOR_LISTING_MANAGE]}>
            <Availability />
          </Protected>
        }
      />
      <Route
        path="/accounts"
        element={
          <Protected requires={[Permission.BOOKING_READ_INCOMING]}>
            <Accounts />
          </Protected>
        }
      />
      <Route
        path="/notifications"
        element={
          <Protected>
            <Notifications />
          </Protected>
        }
      />
      <Route
        path="/admin"
        element={
          <Protected requires={[Permission.ADMIN_ANALYTICS_READ]}>
            <Admin />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
