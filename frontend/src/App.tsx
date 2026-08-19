import { Navigate, Route, Routes, Link, useLocation, useNavigate } from 'react-router-dom';
import { ReactNode, useEffect } from 'react';
import { useAuth } from './store/auth';
import { api } from './lib/api';
import { Permission, PermissionValue, ROLE_LABEL, canAny } from './lib/permissions';
import Login from './pages/Login';
import Register from './pages/Register';
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
import ProviderConsole from './pages/ProviderConsole';
import WeddingPlanners from './pages/WeddingPlanners';
import Forbidden from './pages/Forbidden';

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
  { to: '/clients', label: 'My Clients', requires: [Permission.CLIENT_READ] },
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
  { to: '/admin', label: 'Admin', requires: [Permission.ADMIN_ANALYTICS_READ] },
];

function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
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

  const permissions = user?.permissions ?? [];
  const visible = NAV.filter((n) => n.requires.length === 0 || canAny(permissions, n.requires));

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link to="/" className="text-xl font-bold text-brand">
            WOW
          </Link>
          <nav className="hidden gap-1 md:flex">
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
                {user ? ROLE_LABEL[user.role] ?? user.role : ''}
              </p>
            </div>
            <button
              className="btn-outline"
              onClick={() => {
                logout();
                nav('/login');
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </header>
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
  const permissions = useAuth((s) => s.user?.permissions ?? []);

  if (!token) return <Navigate to="/login" replace />;
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
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/album/:token" element={<SharedAlbum />} />

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
        path="/matches"
        element={
          <Protected requires={[Permission.MATCH_BROWSE]}>
            <Matches />
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
