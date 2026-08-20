import { Navigate, Route, Routes, Link, useLocation, useNavigate } from 'react-router-dom';
import { ReactNode, useEffect } from 'react';
import { useAuth } from './store/auth';
import { api, bootstrapSession } from './lib/api';
import { Permission, PermissionValue, ROLE_LABEL, canAny } from './lib/permissions';
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
  { to: '/travel', label: 'Travel', requires: [Permission.TRAVEL_BOOK] },
  { to: '/media', label: 'Media', requires: [Permission.MEDIA_MANAGE_OWN] },
  { to: '/genie', label: 'WOW Genie', requires: [Permission.AI_ASSIST] },
  {
    to: '/verification',
    label: 'Verification',
    requires: [Permission.VERIFICATION_PROCESS, Permission.VERIFICATION_ALLOCATE],
  },
  { to: '/security', label: 'Security', requires: [Permission.SESSION_MANAGE_OWN] },
  { to: '/admin', label: 'Admin', requires: [Permission.ADMIN_ANALYTICS_READ] },
];

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
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm text-gray-600">{user?.email}</p>
              <p className="text-xs text-gray-400">
                {user ? (ROLE_LABEL[user.role] ?? user.role) : ''}
              </p>
            </div>
            <button className="btn-outline" onClick={signOut}>
              Logout
            </button>
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
