import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { navDenied } from '../lib/nav-access';
import { useBusinesses } from '../store/business';
import { Permission, PermissionValue, ROLE_LABEL, UserRole, canAny } from '../lib/permissions';
import { ReactNode } from 'react';
import ClaimRequests from '../components/ClaimRequests';
import GetStarted from '../components/GetStarted';
import VendorDashboard from '../components/VendorDashboard';
import IndividualDashboard from '../components/IndividualDashboard';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from '@phosphor-icons/react';

interface Tile {
  to: string;
  title: string;
  desc: string;
  requires: PermissionValue[];
  /** Mirrors the navbar: a role that holds the capability but not the entry. */
  hideFor?: UserRole[];
}

/**
 * One tile catalogue for every persona; each tile declares what it needs, and
 * the dashboard renders only the ones the signed-in account can actually use.
 */
const TILES: Tile[] = [
  {
    to: '/profile',
    title: 'Your Profile',
    desc: 'Complete your details to get better matches',
    requires: [Permission.PROFILE_MANAGE_OWN],
  },
  {
    to: '/client-profiles',
    title: 'Client Profiles',
    desc: 'Build a profile for someone who has not joined yet, then invite them',
    requires: [Permission.MANAGED_PROFILE_MANAGE],
    hideFor: ['family'],
  },
  {
    to: '/shared-with-me',
    title: 'Shared With Me',
    desc: 'Biodata other agencies have circulated to you',
    requires: [Permission.ACT_ON_BEHALF],
    hideFor: ['family'],
  },
  {
    to: '/pool',
    title: 'Network Pool',
    desc: 'Profiles other approved agencies have opened to the network',
    requires: [Permission.NETWORK_POOL_BROWSE],
  },
  {
    to: '/interests',
    title: 'Interests',
    desc: 'Who has asked about you, who you have asked, and what came of it',
    requires: [Permission.MATCH_BROWSE, Permission.ACT_ON_BEHALF],
    hideFor: ['vendor', 'planner', 'in_person'],
  },
  {
    to: '/clients',
    title: 'My Clients',
    desc: 'Accounts created when a client accepted your invitation',
    requires: [Permission.CLIENT_READ],
  },
  {
    to: '/agency',
    title: 'My Agency',
    desc: 'Your registration details and approval status',
    requires: [Permission.AGENCY_MANAGE],
  },
  {
    to: '/biodata',
    title: 'Biodata',
    desc: 'The details every family asks about, section by section',
    requires: [Permission.MATCH_BROWSE, Permission.MANAGED_PROFILE_MANAGE],
  },
  {
    to: '/matches',
    title: 'Find Matches',
    desc: 'Discover compatible partners',
    requires: [Permission.MATCH_BROWSE],
  },
  {
    to: '/chat',
    title: 'Messages',
    desc: 'Talk to matches, providers and agents',
    requires: [Permission.CHAT_INQUIRE, Permission.CHAT_MATCH],
    // Kept in step with the nav table: a planner's and an officer's
    // conversations belong to the job or the case they are about.
    hideFor: ['vendor', 'planner', 'in_person'],
  },
  {
    to: '/vendors',
    title: 'Vendors',
    desc: 'Browse venues, catering, photography and more',
    requires: [Permission.BOOKING_CREATE],
  },
  {
    to: '/wedding-planners',
    title: 'Hire a Planner',
    desc: 'Find somebody to run your wedding end to end',
    requires: [Permission.BOOKING_CREATE],
  },
  {
    to: '/console',
    title: 'My Business',
    desc: 'Your listing and the bookings coming in',
    requires: [Permission.VENDOR_LISTING_MANAGE, Permission.PLANNER_LISTING_MANAGE],
  },
  {
    to: '/availability',
    title: 'Availability',
    desc: 'Publish the windows you can take work in',
    requires: [Permission.VENDOR_LISTING_MANAGE],
  },
  {
    to: '/accounts',
    title: 'Accounts',
    desc: 'What you have earned and what is still in escrow',
    requires: [Permission.BOOKING_READ_INCOMING],
  },
  {
    to: '/events',
    title: 'Events',
    desc: 'Each day of the wedding, its guests and its vendors',
    requires: [Permission.EVENT_MANAGE_OWN],
  },
  {
    to: '/travel',
    title: 'Honeymoon',
    desc: 'Packages by budget and by how long you have',
    requires: [Permission.TRAVEL_BOOK],
  },
  {
    to: '/planner',
    title: 'My Wedding Plan',
    desc: 'Your own timeline, worked back from the date',
    requires: [Permission.PLAN_MANAGE_OWN, Permission.PLAN_MANAGE_ENGAGED],
  },
  {
    to: '/bookings',
    title: 'Bookings',
    // A provider reaches the same page from the other side — the work coming
    // in against their listings, which used to be duplicated on My Business.
    desc: 'Requests, quotations, confirmations and escrow',
    requires: [Permission.BOOKING_READ_OWN, Permission.BOOKING_READ_INCOMING],
  },
  {
    to: '/genie',
    title: 'WOW Genie',
    desc: 'AI budget insights and planning help',
    requires: [Permission.AI_ASSIST],
  },
  {
    to: '/notifications',
    title: 'Notifications',
    desc: 'Everything that has happened since you were last here',
    requires: [],
  },
  {
    to: '/security',
    title: 'Security',
    desc: 'Password, two-factor and signed-in devices',
    requires: [Permission.SESSION_MANAGE_OWN],
  },
  {
    to: '/admin',
    title: 'Admin',
    desc: 'Approvals, analytics, disputes and the audit trail',
    requires: [Permission.ADMIN_ANALYTICS_READ],
  },
];

export default function Dashboard() {
  const user = useAuth((s) => s.user);
  const permissions = user?.permissions ?? [];

  const isProvider = canAny(permissions, [Permission.BOOKING_READ_INCOMING]);
  const isBuyer = canAny(permissions, [Permission.BOOKING_READ_OWN]);

  const { data: profile } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
    retry: false,
  });

  // A dashboard that only links to other pages tells you nothing you did not
  // already know. These are the three numbers each persona opens the app for.
  const { data: unread } = useQuery({
    queryKey: ['unread-count'],
    queryFn: async () => (await api.get('/notifications/unread-count')).data,
    retry: false,
  });

  // The provider dashboard always refetches on mount (EZ1-I118): navigating back
  // to it after changing something in another module shows the current figures,
  // not whatever was cached when it was last open.
  // The provider's "waiting on you" counts poll while the dashboard is open and
  // refresh when the tab regains focus, so a new request shows up without a
  // manual refresh (EZ1-I133), on top of the refetch-on-navigation (EZ1-I118).
  const liveCount = {
    retry: false,
    enabled: isProvider,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  };
  const { data: incoming } = useQuery({
    queryKey: ['incoming-bookings-count'],
    queryFn: async () => (await api.get('/bookings/incoming', { params: { limit: 1 } })).data,
    ...liveCount,
  });

  // "Bookings against your listing" counts everything ever, including jobs
  // finished last year. What a vendor opens the app to find out is how many
  // people are waiting on a price from them right now.
  const { data: newRequests } = useQuery({
    queryKey: ['new-requests-count'],
    queryFn: async () =>
      (await api.get('/bookings/incoming', { params: { limit: 1, status: 'requested' } })).data,
    ...liveCount,
  });

  const { data: earnings } = useQuery({
    queryKey: ['earnings'],
    queryFn: async () => (await api.get('/bookings/earnings')).data,
    retry: false,
    enabled: isProvider,
    refetchOnMount: 'always',
  });

  // A vendor's own summary, for the business the header switcher has selected.
  // Everything here is a number they would otherwise open three pages to find.
  const isVendor = canAny(permissions, [Permission.VENDOR_LISTING_MANAGE]);
  const { active, businesses } = useBusinesses();

  const { data: quoted } = useQuery({
    queryKey: ['awaiting-answer-count'],
    queryFn: async () =>
      (await api.get('/bookings/incoming', { params: { limit: 1, status: 'quotation_sent' } }))
        .data,
    ...liveCount,
    enabled: isVendor,
  });

  const { data: slots } = useQuery({
    queryKey: ['availability-summary', active?.id],
    queryFn: async () => (await api.get(`/vendors/${active?.id}/availability/summary`)).data,
    retry: false,
    enabled: isVendor && Boolean(active?.id),
    refetchOnMount: 'always',
  });

  // A wedding planner is a provider who is not a vendor. Their dashboard opens
  // onto their clients rather than a shop window, so it carries an "action
  // required" band of the things waiting on them (EZ1-I39).
  const isPlanner = isProvider && !isVendor;
  const { data: plannerBook } = useQuery({
    queryKey: ['planner-clients-summary'],
    queryFn: async () =>
      (await api.get('/planner/clients')).data as {
        clients: {
          userId: string;
          name: string;
          status: string;
          weddingDate: string | null;
          location: string | null;
        }[];
        requests: unknown[];
        upcomingTasks?: {
          id: string;
          clientName: string;
          title: string;
          dueDate: string | null;
          overdue: boolean;
        }[];
      },
    retry: false,
    enabled: isPlanner,
  });
  const plannerClients = plannerBook?.clients ?? [];
  const activeClients = plannerClients.filter((c) => c.status === 'active').length;
  const upcomingClients = plannerClients.filter((c) => c.status === 'upcoming').length;
  const plannerRequests = plannerBook?.requests?.length ?? 0;
  // The next few weddings by date, so the band leads with what is coming rather
  // than only how many there are (EZ1-I52).
  const upcomingWeddings = plannerClients
    .filter((c) => c.weddingDate)
    .sort((a, b) => new Date(a.weddingDate!).getTime() - new Date(b.weddingDate!).getTime())
    .slice(0, 4);
  const upcomingTasks = plannerBook?.upcomingTasks ?? [];

  // A marriage agent opens the app to see their book at a glance (EZ1-I79):
  // how many clients, how many are matched, how many are still open, and the
  // interests their profiles have taken part in.
  const isAgent = canAny(permissions, [Permission.AGENCY_MANAGE]);
  const { data: agentStats } = useQuery({
    queryKey: ['agent-stats'],
    queryFn: async () =>
      (await api.get('/agents/stats')).data as {
        totalClients: number;
        matchesFixed: number;
        remainingClients: number;
        totalInterests: number;
      },
    retry: false,
    enabled: isAgent,
  });

  // A verification officer opens the app to see the work waiting on them
  // (EZ1-I92): how many verifications are new, in progress or submitted, and
  // which have a deadline coming up. VERIFICATION_FIELDWORK is held by officers
  // and never by an administrator, so it identifies the persona cleanly.
  const isOfficer = canAny(permissions, [Permission.VERIFICATION_FIELDWORK]);
  const { data: officerQueue } = useQuery({
    queryKey: ['officer-queue'],
    queryFn: async () =>
      (await api.get('/verification/requests', { params: { limit: 100 } })).data as {
        data: { id: string; status: string; deadlineAt?: string | null }[];
      },
    retry: false,
    enabled: isOfficer,
  });
  const officerRequests = officerQueue?.data ?? [];
  const officerCounts = {
    assigned: officerRequests.filter((r) => r.status === 'assigned').length,
    inProgress: officerRequests.filter((r) => r.status === 'in_progress').length,
    submitted: officerRequests.filter((r) => r.status === 'submitted').length,
    additional: officerRequests.filter((r) => r.status === 'additional_review').length,
  };
  const officerOpen = officerCounts.assigned + officerCounts.inProgress + officerCounts.additional;

  const reduce = useReducedMotion();
  const firstName = (profile?.displayName ?? '').trim().split(' ')[0];

  // The same question the sidebar asks, from the same place. This list used to
  // carry its own hideFor, which is how a planner ended up with no Chat in the
  // rail and a Messages tile on their dashboard pointing at it.
  const tiles = TILES.filter(
    (t) =>
      !(user && navDenied(t, user.role)) &&
      (t.requires.length === 0 || canAny(permissions, t.requires)),
  );

  // The vendor's home is a dedicated, backend-driven dashboard (EZ1-I147). All
  // the hooks above still run so the hook order is stable across a role change;
  // the branch is here, after them, rather than as an early return.
  if (isVendor) return <VendorDashboard />;

  return (
    <div className="space-y-10">
      {/*
        A masthead rather than a filled accent panel.

        A solid brand-coloured block at the top of every visit is the loudest
        thing on the page, competing with whatever the page is actually for.
        The greeting carries the same information at a fraction of the volume,
        and the one part of it that is actionable, an unfinished profile, gets
        to be a control instead of a sentence.
      */}
      <header>
        <p className="text-sm text-gray-500">
          Signed in as {user ? (ROLE_LABEL[user.role] ?? user.role) : ''}
          {user?.managedByAgentId ? ', represented by an agent' : ''}
        </p>
        <h1 className="page-title mt-1">
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </h1>
        {profile && !profile.profileCompleted && (
          <div className="mt-5 flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-surface p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">Your profile is not finished</p>
              <p className="mt-0.5 text-sm text-gray-500">
                Families see a complete profile far more often than an incomplete one.
              </p>
            </div>
            <Link className="btn shrink-0" to="/profile">
              Finish profile
              <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
        )}
      </header>

      {/*
        The provider equivalent of the profile nudge above it.

        Same reason, and a worse consequence: an unfinished profile is seen by
        fewer families, while an unwritten listing cannot be found at all and
        never reaches an administrator. It renders nothing once the business is
        live.
      */}
      <GetStarted />

      <ClaimRequests />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Counter
          label="Unread notifications"
          value={unread?.unread ?? 0}
          to="/notifications"
        />
        {isProvider && (
          <>
            {/*
              A planner already has "Requests to answer" in the action band below,
              off the same requested-booking count — so this generic card would be
              the same number under a second name, which is the confusion reported
              in EZ1-I52. It stays for a vendor, whose dashboard has no such band.
            */}
            {!isPlanner && (
              <Counter
                label="New requests"
                value={newRequests?.total ?? 0}
                to="/bookings"
                tone={(newRequests?.total ?? 0) > 0 ? 'text-amber-700' : undefined}
              />
            )}
            <Counter
              label="Bookings in total"
              value={incoming?.total ?? 0}
              to="/bookings"
            />
            <Counter
              label="Held in escrow"
              value={`₹${Number(earnings?.heldInEscrow ?? 0).toLocaleString('en-IN')}`}
              to="/accounts"
            />
          </>
        )}
        {isOfficer && (
          <>
            <Counter
              label="Verifications open"
              value={officerOpen}
              to="/verification"
              tone={officerOpen > 0 ? 'text-amber-700' : undefined}
            />
            <Counter label="In progress" value={officerCounts.inProgress} to="/verification" />
            <Counter label="Submitted" value={officerCounts.submitted} to="/verification" />
          </>
        )}
      </div>

      {/*
        The officer's workload at a glance and the quick way into it (EZ1-I92):
        the counts above break down here by stage, and the button opens the
        queue those numbers belong to.
      */}
      {isOfficer && (
        <div className="rounded-lg border border-gray-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-gray-500">Your verification workload</h2>
            <Link className="btn-outline btn-sm" to="/verification">
              Open the queue
            </Link>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <MiniStat label="Assigned" value={officerCounts.assigned} />
            <MiniStat label="In progress" value={officerCounts.inProgress} />
            <MiniStat label="Submitted" value={officerCounts.submitted} />
            <MiniStat label="Needs another look" value={officerCounts.additional} />
          </div>
        </div>
      )}

      {/*
        The individual couple's home screen (EZ1-I150): matches, interests,
        messages, events, bookings, the wedding plan, the honeymoon and support,
        each a live figure wired to its own module with the right navigation and
        an honest empty state. It owns its own booking counts, so the buckets
        that used to live here (EZ1-I75) now sit inside it.
      */}
      {isBuyer && !isProvider && <IndividualDashboard />}

      {/*
        The agent's book at a glance (EZ1-I79). Separate row from the account
        counters above because these are about the clients they run.
      */}
      {isAgent && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Counter label="Total clients" value={agentStats?.totalClients ?? 0} to="/clients" />
          <Counter
            label="Matches fixed"
            value={agentStats?.matchesFixed ?? 0}
            to="/matches"
            tone={(agentStats?.matchesFixed ?? 0) > 0 ? 'text-emerald-700' : undefined}
          />
          <Counter
            label="Remaining clients"
            value={agentStats?.remainingClients ?? 0}
            to="/clients"
          />
          <Counter label="Total interests" value={agentStats?.totalInterests ?? 0} to="/interests" />
        </div>
      )}

      {/*
        The vendor's own row. Separate from the counters above because these are
        about one business rather than the account — with two businesses the
        header switcher decides which, and these follow it.
      */}
      {isVendor && active && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Counter
            label={businesses.length > 1 ? active.name : 'Your business'}
            value={active.status.replace(/_/g, ' ')}
            to="/console"
            tone={active.isApproved ? 'text-emerald-700' : 'text-amber-700'}
          />
          <Counter
            label="Waiting on the client"
            value={quoted?.total ?? 0}
            to="/bookings"
          />
          <Counter
            label="Open windows"
            value={slots?.openSlots ?? 0}
            to="/availability"
            tone={(slots?.openSlots ?? 0) === 0 ? 'text-amber-700' : undefined}
          />
          <Counter
            label="Paid out"
            value={`₹${Number(earnings?.paidOut ?? 0).toLocaleString('en-IN')}`}
            to="/accounts"
          />
        </div>
      )}

      {/*
        The planner's action band. A planner opens the app to answer the
        couples waiting on them and to keep their weddings moving, not to look
        at a shop window — so the things that need them come first, each with the
        one action that clears it (EZ1-I39).
      */}
      {isPlanner && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-gray-500">Action required</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Counter
              label="Requests to answer"
              value={plannerRequests}
              to="/bookings"
              tone={plannerRequests > 0 ? 'text-amber-700' : undefined}
            />
            <Counter label="Active weddings" value={activeClients} to="/my-clients" />
            <Counter label="Upcoming weddings" value={upcomingClients} to="/my-clients" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link className="btn" to="/bookings">
              Review requests
            </Link>
            <Link className="btn-outline" to="/my-clients">
              Manage clients &amp; tasks
            </Link>
            <Link className="btn-outline" to="/availability">
              Set availability
            </Link>
            <Link className="btn-outline" to="/events">
              View events
            </Link>
          </div>

          {/* What is actually coming and what is actually due — the two lists a
              planner opens the app to see, not just their counts (EZ1-I52). */}
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="card">
              <h3 className="section-title text-sm">Upcoming weddings</h3>
              {upcomingWeddings.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">No dated weddings yet.</p>
              ) : (
                <ul className="mt-2 divide-y">
                  {upcomingWeddings.map((c) => (
                    <li key={c.userId} className="py-1.5 text-sm">
                      <Link className="text-brand-dark hover:underline" to={`/my-clients/${c.userId}`}>
                        {c.name}
                      </Link>
                      <span className="text-gray-500">
                        {' · '}
                        {new Date(c.weddingDate as string).toLocaleDateString()}
                        {c.location ? ` · ${c.location}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card">
              <h3 className="section-title text-sm">Tasks &amp; deadlines</h3>
              {upcomingTasks.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">Nothing due across your weddings.</p>
              ) : (
                <ul className="mt-2 divide-y">
                  {upcomingTasks.slice(0, 6).map((t) => (
                    <li key={t.id} className="flex items-baseline justify-between gap-2 py-1.5 text-sm">
                      <span className="truncate">
                        <span className="text-gray-800">{t.title}</span>
                        <span className="text-gray-400"> · {t.clientName}</span>
                      </span>
                      {t.dueDate && (
                        <span
                          className={`shrink-0 text-xs ${
                            t.overdue ? 'font-medium text-red-600' : 'text-gray-500'
                          }`}
                        >
                          {t.overdue ? 'overdue · ' : ''}
                          {new Date(t.dueDate).toLocaleDateString()}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {/*
        Where to go next.

        Rows, not a grid of identical cards. Equal boxes side by side give every
        destination the same weight and stop being scannable at about the sixth
        one; a divided column reads top to bottom the way a list of choices is
        actually read, and keeps each description on one line instead of
        wrapping it into a paragraph nobody finishes.
      */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-gray-500">Where to go next</h2>
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-surface">
          {tiles.map((t, i) => (
            <motion.li
              key={t.to}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: Math.min(i, 8) * 0.035, ease: [0.16, 1, 0.3, 1] }}
            >
              <Link
                to={t.to}
                className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-gray-100"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">{t.title}</p>
                  <p className="mt-0.5 truncate text-sm text-gray-500">{t.desc}</p>
                </div>
                <ArrowRight
                  size={17}
                  className="shrink-0 text-gray-300 transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-brand-strong"
                  aria-hidden
                />
              </Link>
            </motion.li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Time of day, from the browser. Nothing about it needs a round trip. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** A small labelled figure inside a band, with no link of its own (EZ1-I92). */
function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md bg-surface-sunken p-3">
      <p className="truncate text-xs text-gray-500">{label}</p>
      <p className="mt-1 font-mono text-xl font-medium leading-none text-gray-900">{value}</p>
    </div>
  );
}

function Counter({
  label,
  value,
  to,
  tone,
}: {
  label: string;
  value: ReactNode;
  to: string;
  /** Set only when the number means somebody has to do something. */
  tone?: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-lg border border-gray-200 bg-surface p-4 transition-[border-color,box-shadow] duration-200 hover:border-gray-300 hover:shadow-card"
    >
      <p className="truncate text-[0.8125rem] text-gray-500">{label}</p>
      {/*
        Mono and tabular. These sit in a row and get compared against each
        other; proportional digits make a column of numbers ripple.
      */}
      <p
        className={`mt-1.5 font-mono text-[1.75rem] font-medium leading-none tracking-[-0.02em] ${tone ?? 'text-gray-900'}`}
      >
        {value}
      </p>
    </Link>
  );
}
