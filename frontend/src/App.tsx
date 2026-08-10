import { Navigate, Route, Routes, Link, useLocation, useNavigate } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from './store/auth';
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

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/matches', label: 'Matches' },
  { to: '/chat', label: 'Chat' },
  { to: '/vendors', label: 'Vendors' },
  { to: '/planner', label: 'Planner' },
  { to: '/bookings', label: 'Bookings' },
  { to: '/events', label: 'Events' },
  { to: '/travel', label: 'Travel' },
  { to: '/media', label: 'Media' },
  { to: '/genie', label: 'WOW Genie' },
  { to: '/admin', label: 'Admin' },
];

function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-xl font-bold text-brand">
            WOW
          </Link>
          <nav className="hidden gap-1 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={`rounded px-3 py-1.5 text-sm ${
                  loc.pathname === n.to ? 'bg-brand-light text-brand-dark' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-gray-500 sm:inline">{user?.email}</span>
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

function Protected({ children }: { children: ReactNode }) {
  const token = useAuth((s) => s.accessToken);
  if (!token) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/album/:token" element={<SharedAlbum />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />
      <Route path="/matches" element={<Protected><Matches /></Protected>} />
      <Route path="/vendors" element={<Protected><Vendors /></Protected>} />
      <Route path="/planner" element={<Protected><Planner /></Protected>} />
      <Route path="/chat" element={<Protected><Chat /></Protected>} />
      <Route path="/bookings" element={<Protected><Bookings /></Protected>} />
      <Route path="/events" element={<Protected><Events /></Protected>} />
      <Route path="/travel" element={<Protected><Travel /></Protected>} />
      <Route path="/media" element={<Protected><Media /></Protected>} />
      <Route path="/genie" element={<Protected><Genie /></Protected>} />
      <Route path="/admin" element={<Protected><Admin /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
