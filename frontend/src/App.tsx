import { Navigate, Route, Routes, Link, useLocation, useNavigate } from 'react-router-dom';
import { ReactNode, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './store/auth';
import { api, bootstrapSession } from './lib/api';
import { Permission, PermissionValue, ROLE_LABEL, UserRole, canAny } from './lib/permissions';
import { navDenied } from './lib/nav-access';
import { UNREAD_POLL_MS } from './lib/notification-copy';
import type { Icon } from '@phosphor-icons/react';
import {
  AddressBook,
  AirplaneTilt,
  Bell,
  Briefcase,
  Buildings,
  CalendarBlank,
  CalendarCheck,
  ChatCircle,
  ClipboardText,
  Coins,
  Confetti,
  Gauge,
  Graph,
  HandHeart,
  House,
  IdentificationCard,
  Images,
  Lifebuoy,
  MagicWand,
  Receipt,
  SealCheck,
  ShareNetwork,
  ShieldCheck,
  Sparkle,
  Storefront,
  UsersThree,
  CaretDown,
  Desktop,
  List,
  Moon,
  SignOut,
  Sun,
  UserCircle,
  Warning,
} from '@phosphor-icons/react';
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import { useTheme } from './store/theme';
import { motion, useReducedMotion } from 'motion/react';
import Login from './pages/Login';
import Register from './pages/Register';
import AcceptInvite from './pages/AcceptInvite';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import GuestRsvp from './pages/GuestRsvp';
import SharedInvitation from './pages/SharedInvitation';
import Dashboard from './pages/Dashboard';
import Profile from './pages/Profile';
import Matches from './pages/Matches';
import Vendors from './pages/Vendors';
import Planner from './pages/Planner';
import PlannerClients from './pages/PlannerClients';
import PlannerClientDetail from './pages/PlannerClientDetail';
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
import Interests from './pages/Interests';
import SharedBiodata from './pages/SharedBiodata';
import Agency from './pages/Agency';
import Security from './pages/Security';
import Support from './pages/Support';
import ProviderConsole from './pages/ProviderConsole';
import WeddingPlanners from './pages/WeddingPlanners';
import Forbidden from './pages/Forbidden';
import Verification from './pages/Verification';
import SetPassword from './pages/SetPassword';
import Availability from './pages/Availability';
import Accounts from './pages/Accounts';
import Notifications from './pages/Notifications';
import Biodata from './pages/Biodata';
import BusinessSwitcher from './components/BusinessSwitcher';
import { Loading } from './components/ui/Feedback';

/**
 * Every nav entry declares the capabilities it needs. A user sees an entry only
 * if they hold at least one of them, which is what keeps a vendor from being
 * shown Matches or a bride from being shown the Admin console.
 */
interface NavEntry {
  to: string;
  label: string;
  requires: PermissionValue[];
  /**
   * Roles that hold the permission but should not see the entry.
   *
   * Used sparingly, and only where the capability is real but the *entry* is
   * redundant for that role — a vendor can chat, and does, but every one of
   * their conversations is about a job, so the conversation lives on the job.
   * A top-level Chat menu offers them a thread the booking rules cannot reach.
   */
  hideFor?: UserRole[];
  /**
   * Which band of the sidebar this sits in.
   *
   * The navigation carried twenty-five destinations in one wrapping pill row,
   * which at any real window width became two lines of pills and stopped being
   * scannable at about the eighth item. Grouping is what makes a list that long
   * navigable: nobody reads twenty-five labels, everybody reads five headings.
   *
   * Most accounts see three or four of these, because the entries are already
   * filtered by capability before the groups are drawn.
   */
  group: NavGroup;
  icon: Icon;
}

export type NavGroup = 'main' | 'matchmaking' | 'clients' | 'wedding' | 'business' | 'operations' | 'account';

/** Order is the order they appear. Titles are omitted for `main` on purpose. */
export const NAV_GROUPS: { key: NavGroup; title: string | null }[] = [
  { key: 'main', title: null },
  { key: 'matchmaking', title: 'Matchmaking' },
  { key: 'clients', title: 'Clients' },
  { key: 'wedding', title: 'The wedding' },
  { key: 'business', title: 'Your business' },
  { key: 'operations', title: 'Operations' },
  { key: 'account', title: 'Account' },
];

const NAV: NavEntry[] = [
  { to: '/', label: 'Dashboard', requires: [], group: 'main', icon: House },
  { to: '/matches', label: 'Matches', requires: [Permission.MATCH_BROWSE], group: 'matchmaking', icon: Sparkle },
  {
    to: '/biodata',
    label: 'Biodata',
    requires: [Permission.MATCH_BROWSE, Permission.MANAGED_PROFILE_MANAGE],
    group: 'matchmaking',
    icon: IdentificationCard,
  },
  {
    to: '/chat',
    label: 'Chat',
    requires: [Permission.CHAT_INQUIRE, Permission.CHAT_MATCH],
    // Not for vendors: theirs is inside the booking, where it opens on the
    // advance and locks when the job is done.
    //
    // Nor for a planner or a verification officer. Both hold CHAT_INQUIRE
    // because both legitimately talk to people — a planner inside a booking,
    // an officer inside a case — and a general-purpose message list is a
    // second, unscoped channel into the same conversations. The officer's is
    // the sharper version of the problem: their whole job is to be an
    // independent visitor, and a private line to the applicant they are
    // assessing is not something to leave lying about.
    hideFor: ['vendor', 'planner', 'in_person'],
    group: 'matchmaking',
    icon: ChatCircle,
  },
  {
    to: '/client-profiles',
    label: 'Client Profiles',
    requires: [Permission.MANAGED_PROFILE_MANAGE],
    /*
     * A family member has relatives, not clients.
     *
     * They hold the same stewardship capability an agency does — that is how
     * a father runs his daughter's profile — so the permission cannot tell the
     * two apart. But "Client Profiles" and "Shared With Me" are an agency's
     * vocabulary for an agency's business, and putting them in front of a
     * family reads as though the platform has mistaken them for one. The
     * profiles themselves are still reachable from Biodata, where a family
     * member actually looks for them.
     */
    hideFor: ['family'],
    group: 'clients',
    icon: UsersThree,
  },
  {
    to: '/shared-with-me',
    label: 'Shared With Me',
    requires: [Permission.ACT_ON_BEHALF],
    // Circulation is agency-to-agency. Nothing is ever shared with a family.
    hideFor: ['family'],
    group: 'clients',
    icon: ShareNetwork,
  },
  { to: '/pool', label: 'Network Pool', requires: [Permission.NETWORK_POOL_BROWSE], group: 'clients', icon: Graph },
  {
    to: '/interests',
    label: 'Interests',
    // Everybody who can be asked about, plus the stewards who answer on
    // somebody's behalf. It used to be steward-only and called Proposals,
    // which left an individual with no screen showing who had asked about
    // them.
    requires: [Permission.MATCH_BROWSE, Permission.ACT_ON_BEHALF],
    // A family member stewards a relative and is also a client; a vendor has
    // no profile to be asked about at all.
    hideFor: ['vendor', 'planner', 'in_person'],
    group: 'matchmaking',
    icon: HandHeart,
  },
  { to: '/clients', label: 'My Clients', requires: [Permission.CLIENT_READ], group: 'clients', icon: AddressBook },
  /*
   * A planner's clients, which are not an agent's clients.
   *
   * Kept as its own address rather than sharing /clients: an agent's client is
   * somebody whose profile they manage, a planner's is a wedding they were
   * hired to run, and the two pages answer different questions. One route
   * serving both would need a fork at the top of every screen below it.
   */
  { to: '/my-clients', label: 'My Clients', requires: [Permission.PLAN_MANAGE_ENGAGED], group: 'clients', icon: AddressBook },
  { to: '/agency', label: 'My Agency', requires: [Permission.AGENCY_MANAGE], group: 'clients', icon: Buildings },
  { to: '/vendors', label: 'Vendors', requires: [Permission.BOOKING_CREATE], group: 'wedding', icon: Storefront },
  // "Planners" and "Planner" next to each other were indistinguishable. One is
  // the marketplace where a planner is hired; the other is the couple's own
  // timeline. The labels now say which is which.
  { to: '/wedding-planners', label: 'Hire a Planner', requires: [Permission.BOOKING_CREATE], group: 'wedding', icon: ClipboardText },
  {
    to: '/console',
    label: 'My Business',
    requires: [Permission.VENDOR_LISTING_MANAGE, Permission.PLANNER_LISTING_MANAGE],
    group: 'business',
    icon: Briefcase,
  },
  {
    to: '/availability',
    label: 'Availability',
    // Both kinds of provider now. A planner takes bookings against dates
    // exactly as a vendor does; availability was simply keyed to vendors.
    requires: [Permission.VENDOR_LISTING_MANAGE, Permission.PLANNER_LISTING_MANAGE],
    group: 'business',
    icon: CalendarBlank,
  },
  { to: '/accounts', label: 'Accounts', requires: [Permission.BOOKING_READ_INCOMING], group: 'business', icon: Coins },
  {
    to: '/planner',
    label: 'My Wedding Plan',
    requires: [Permission.PLAN_MANAGE_OWN, Permission.PLAN_MANAGE_ENGAGED],
    /*
     * Not the wedding planner's, despite the permission.
     *
     * `requires` is any-of, and a planner holds PLAN_MANAGE_ENGAGED because
     * they genuinely co-manage the weddings they are hired for. So the entry
     * matched and the screen appeared — but this screen is the couple's own
     * timeline, it is written in the couple's voice ("Your own timeline",
     * "Looking to hire a wedding planner?"), and generating a plan on it needs
     * PLAN_MANAGE_OWN, which a planner does not hold. Pressing the button
     * produced a permission error naming a capability the account was never
     * meant to have.
     *
     * The screen a planner should reach from here — a client's wedding they
     * are engaged on — does not exist yet. Offering them the couple's instead
     * is worse than offering nothing, so the entry goes until that is built.
     */
    hideFor: ['planner'],
    group: 'wedding',
    icon: CalendarCheck,
  },
  {
    to: '/bookings',
    label: 'Bookings',
    requires: [Permission.BOOKING_READ_OWN, Permission.BOOKING_READ_INCOMING],
    group: 'wedding',
    icon: Receipt,
  },
  {
    to: '/events',
    label: 'Events',
    // A planner keeps this: the page now lets them pick a wedding they were
    // engaged for, where before it listed their own days — of which there are
    // none, because a planner is not the one getting married.
    requires: [Permission.EVENT_MANAGE_OWN, Permission.PLAN_MANAGE_ENGAGED],
    group: 'wedding',
    icon: Confetti,
  },
  { to: '/travel', label: 'Honeymoon', requires: [Permission.TRAVEL_BOOK], group: 'wedding', icon: AirplaneTilt },
  { to: '/media', label: 'Media', requires: [Permission.MEDIA_MANAGE_OWN], group: 'wedding', icon: Images },
  { to: '/genie', label: 'WOW Genie', requires: [Permission.AI_ASSIST], group: 'account', icon: MagicWand },
  {
    to: '/verification',
    label: 'Verification',
    requires: [Permission.VERIFICATION_PROCESS, Permission.VERIFICATION_ALLOCATE],
    group: 'operations',
    icon: SealCheck,
  },
  { to: '/notifications', label: 'Notifications', requires: [], group: 'account', icon: Bell },
  // Vendors had nowhere at all to say something had gone wrong outside a
  // booking they were already inside. Everyone who can raise a case gets it.
  { to: '/support', label: 'Support', requires: [Permission.CASE_RAISE], group: 'account', icon: Lifebuoy },
  // Security sits in the navigation rather than under the email dropdown:
  // sessions, two-factor and recovery codes are things people go looking for,
  // and a menu they have to discover first is a menu they never open.
  { to: '/security', label: 'Security', requires: [], group: 'account', icon: ShieldCheck },
  { to: '/admin', label: 'Admin', requires: [Permission.ADMIN_ANALYTICS_READ], group: 'operations', icon: Gauge },
];

/** Path to the roles refused it, for the route guard. */
const DENIED_BY_PATH: { to: string; hideFor?: UserRole[] }[] = NAV;

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
 * lot of machinery for one number.
 *
 * The interval lives in lib/notification-copy alongside the wording, so the
 * feed polls on the same clock without importing this file.
 */
function useUnreadCount(): number {
  const { data } = useQuery({
    queryKey: ['unread-count'],
    queryFn: async () => (await api.get('/notifications/unread-count')).data,
    refetchInterval: UNREAD_POLL_MS,
    retry: false,
  });
  return data?.unread ?? 0;
}


/**
 * How the account signs out, switches business, and changes theme.
 *
 * A popover rather than three controls in the bar: none of them is used often,
 * and three rarely-used controls beside the one thing that is used constantly
 * (the navigation) is how a header stops being scannable.
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
  const { choice, set } = useTheme();

  useEffect(() => setOpen(false), [loc.pathname]);

  const initial = (email ?? '?').slice(0, 1).toUpperCase();

  return (
    <div className="relative">
      <button
        className="flex items-center gap-2.5 rounded-md p-1 pr-2 text-left transition-colors hover:bg-gray-100"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft
            text-[0.8125rem] font-semibold text-brand-strong"
          aria-hidden
        >
          {initial}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block max-w-[13rem] truncate text-[0.8125rem] font-medium text-gray-800">
            {email}
          </span>
          <span className="block text-[0.6875rem] text-gray-400">
            {role ? (ROLE_LABEL[role] ?? role) : ''}
          </span>
        </span>
        <CaretDown size={14} className="shrink-0 text-gray-400" aria-hidden />
      </button>

      {open && (
        <>
          {/* Click-away. A bare document listener would fight the toggle above. */}
          <button
            className="fixed inset-0 z-30 cursor-default"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-lg border
              border-gray-200 bg-surface-raised p-1.5 shadow-pop"
          >
            <Link
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-gray-700
                transition-colors hover:bg-gray-100"
              to="/profile"
            >
              <UserCircle size={17} aria-hidden /> My Profile
            </Link>

            <div className="my-1.5 px-2.5">
              <p className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-gray-400">
                Appearance
              </p>
              {/*
                Three states, not a switch. "System" is a real answer and the
                default one; a two-way toggle forces somebody whose laptop
                already flips at dusk to pick a side and then re-pick it.
              */}
              <div
                role="radiogroup"
                aria-label="Appearance"
                className="flex gap-1 rounded-md bg-surface-sunken p-1"
              >
                {(
                  [
                    ['light', 'Light', Sun],
                    ['dark', 'Dark', Moon],
                    ['system', 'Auto', Desktop],
                  ] as const
                ).map(([value, label, Glyph]) => (
                  <button
                    key={value}
                    role="radio"
                    aria-checked={choice === value}
                    onClick={() => set(value)}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-sm px-2 py-1.5
                      text-[0.6875rem] font-medium transition-colors ${
                        choice === value
                          ? 'bg-surface-raised text-gray-900 shadow-btn'
                          : 'text-gray-500 hover:text-gray-800'
                      }`}
                  >
                    <Glyph size={13} aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <button
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm
                text-gray-700 transition-colors hover:bg-gray-100"
              onClick={onSignOut}
            >
              <SignOut size={17} aria-hidden /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Layout({ children }: { children: ReactNode }) {
  const { user, clear } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [drawer, setDrawer] = useState(false);
  const reduce = useReducedMotion();

  const signOut = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      clear();
      nav('/login');
    }
  };

  const permissions = user?.permissions ?? [];
  const visible = NAV.filter(
    (n) =>
      !(user && navDenied(n, user.role)) &&
      (n.requires.length === 0 || canAny(permissions, n.requires)),
  );
  const unread = useUnreadCount();

  /*
   * An administrator gets no group headings.
   *
   * The headings are the consumer's vocabulary — "The wedding", "Your
   * business" — which is right for the twenty-odd destinations a couple or a
   * vendor sees and reads as nonsense over an operations console: Bookings
   * filed under somebody's wedding, Accounts under a business the
   * administrator does not have. Eight entries do not need banding anyway;
   * grouping earns its place at about fifteen.
   */
  const groups =
    user?.role === 'admin' ? NAV_GROUPS.map((g) => ({ ...g, title: null })) : NAV_GROUPS;
  const entries = visible.map((n) => ({
    to: n.to,
    label: n.label,
    icon: n.icon,
    group: n.group,
    badge: n.to === '/notifications' ? unread : undefined,
  }));

  // The drawer closes on navigation. Leaving it open over the page somebody
  // just asked for is the most common way a mobile menu goes wrong.
  useEffect(() => setDrawer(false), [loc.pathname]);

  return (
    <div className="min-h-[100dvh] bg-canvas">
      {/*
        Two columns above `lg`, one below. The rail is sticky and scrolls
        independently, so a long navigation never pushes the page down and the
        content column keeps its own scroll position.
      */}
      <div className="mx-auto flex w-full max-w-content gap-8 px-4 sm:px-6 lg:px-8">
        <aside className="sticky top-0 hidden h-[100dvh] w-[15.5rem] shrink-0 flex-col gap-5 py-5 lg:flex">
          <Wordmark />
          <div className="-mr-2 flex-1 overflow-y-auto pr-2">
            <Sidebar entries={entries} groups={groups} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className="sticky top-0 z-20 -mx-4 flex h-16 items-center justify-between gap-3
              border-b border-gray-200 bg-canvas/80 px-4 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0"
          >
            <div className="flex min-w-0 items-center gap-3">
              <button
                className="btn-ghost -ml-1.5 px-2 lg:hidden"
                onClick={() => setDrawer(true)}
                aria-label="Open navigation"
              >
                <List size={20} aria-hidden />
              </button>
              <span className="lg:hidden">
                <Wordmark compact />
              </span>
              <h1 className="hidden truncate text-sm font-medium text-gray-500 lg:block">
                {visible.find((n) => n.to === loc.pathname)?.label ?? ''}
              </h1>
            </div>

            <div className="flex items-center gap-2">
              {/* Only rendered for an account that holds more than one business. */}
              {canAny(permissions, [Permission.VENDOR_LISTING_MANAGE]) && <BusinessSwitcher />}
              <AccountMenu email={user?.email} role={user?.role} onSignOut={signOut} />
            </div>
          </header>

          {user && !user.isVerified && (
            <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-caution-fg/25 bg-caution-bg px-4 py-3 text-sm text-caution-fg">
              <Warning size={17} className="mt-0.5 shrink-0" aria-hidden />
              <p>
                Please confirm your email address.{' '}
                <Link className="font-medium underline underline-offset-2" to="/security">
                  Resend the confirmation
                </Link>
                .
              </p>
            </div>
          )}

          {/*
            A short rise on route change. Long enough to register as a change of
            place, short enough that nobody waiting on it notices waiting. It is
            keyed on the path, so it fires per navigation rather than per render.
          */}
          <motion.main
            key={loc.pathname}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 py-6 pb-20"
          >
            {/*
              Keyed on the path, so leaving a screen that failed clears the
              error rather than stranding somebody on it. Inside the main
              element rather than around the layout, because the whole point is
              that the rail and the account menu survive: a person whose page
              broke needs a way off it.
            */}
            <ErrorBoundary key={loc.pathname}>{children}</ErrorBoundary>
          </motion.main>
        </div>
      </div>

      {/* Mobile drawer. Same component, same grouping, different container. */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <motion.button
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-scrim/55 backdrop-blur-sm"
            aria-label="Close navigation"
            onClick={() => setDrawer(false)}
          />
          <motion.div
            initial={reduce ? false : { x: '-100%' }}
            animate={{ x: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            className="absolute inset-y-0 left-0 flex w-[17rem] flex-col gap-5 overflow-y-auto
              border-r border-gray-200 bg-surface p-5"
          >
            <Wordmark />
            <Sidebar entries={entries} groups={groups} onNavigate={() => setDrawer(false)} />
          </motion.div>
        </div>
      )}
    </div>
  );
}

/**
 * The mark.
 *
 * Set in the display face at a tight track with the two halves weighted
 * differently, so it reads as a wordmark rather than as the first heading on
 * the page. No drawn logo: an invented glyph would be a decoration standing in
 * for an identity the brand has not decided on yet.
 */
function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-baseline gap-1.5 px-3 py-1">
      <span className="text-[1.375rem] font-semibold tracking-[-0.04em] text-gray-900">WOW</span>
      {!compact && (
        <span className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-gray-400">
          World of Weddings
        </span>
      )}
    </Link>
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
  const role = useAuth((s) => s.user?.role);
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const mustResetPassword = useAuth((s) => s.user?.mustResetPassword ?? false);
  const path = useLocation().pathname;

  // Tokens are held in memory now, so a reload has nothing until the silent
  // refresh finishes. Waiting here stops a signed-in user being bounced to
  // /login for a frame on every page load.
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading rows={3} />
      </div>
    );
  }
  if (!token) return <Navigate to="/login" replace />;

  // An account still holding an emailed temporary password can reach exactly
  // one screen. The server enforces this; sending them there directly saves
  // them a wall of refusals on the way to the same place.
  if (mustResetPassword) return <Navigate to="/set-password" replace />;

  /*
   * A role refused the link is refused the address.
   *
   * Permission alone cannot express this. The officer holds CHAT_INQUIRE and
   * the administrator holds everything, so both passed the check below and got
   * a page neither should have — the officer a private line to the applicant
   * they are assessing, the admin the couple's honeymoon planner.
   */
  const entry = role ? DENIED_BY_PATH.find((n) => n.to === path) : undefined;
  if (role && entry && navDenied(entry, role)) return <Navigate to="/" replace />;

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
      {/*
        Public, like the per-guest RSVP above it. Whoever the link reached can
        open it; that is what a forwarded invitation is.
      */}
      <Route path="/invitation/:token" element={<SharedInvitation />} />
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
        path="/interests"
        element={
          <Protected requires={[Permission.MATCH_BROWSE, Permission.ACT_ON_BEHALF]}>
            <Interests />
          </Protected>
        }
      />
      {/* The old address still works: a bookmark should not 404 because a
          section was renamed. */}
      <Route path="/proposals" element={<Navigate to="/interests" replace />} />
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
        path="/my-clients"
        element={
          <Protected requires={[Permission.PLAN_MANAGE_ENGAGED]}>
            <PlannerClients />
          </Protected>
        }
      />
      <Route
        path="/my-clients/:userId"
        element={
          <Protected requires={[Permission.PLAN_MANAGE_ENGAGED]}>
            <PlannerClientDetail />
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
        path="/support"
        element={
          <Protected requires={[Permission.CASE_RAISE]}>
            <Support />
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
          <Protected requires={[Permission.VENDOR_LISTING_MANAGE, Permission.PLANNER_LISTING_MANAGE]}>
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
