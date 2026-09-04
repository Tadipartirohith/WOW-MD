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

  const { data: incoming } = useQuery({
    queryKey: ['incoming-bookings-count'],
    queryFn: async () => (await api.get('/bookings/incoming', { params: { limit: 1 } })).data,
    retry: false,
    enabled: isProvider,
  });

  // "Bookings against your listing" counts everything ever, including jobs
  // finished last year. What a vendor opens the app to find out is how many
  // people are waiting on a price from them right now.
  const { data: newRequests } = useQuery({
    queryKey: ['new-requests-count'],
    queryFn: async () =>
      (await api.get('/bookings/incoming', { params: { limit: 1, status: 'requested' } })).data,
    retry: false,
    enabled: isProvider,
  });

  const { data: earnings } = useQuery({
    queryKey: ['earnings'],
    queryFn: async () => (await api.get('/bookings/earnings')).data,
    retry: false,
    enabled: isProvider,
  });

  const { data: myBookings } = useQuery({
    queryKey: ['my-bookings-count'],
    queryFn: async () => (await api.get('/bookings', { params: { limit: 1 } })).data,
    retry: false,
    enabled: isBuyer,
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
    retry: false,
    enabled: isVendor,
  });

  const { data: slots } = useQuery({
    queryKey: ['availability-summary', active?.id],
    queryFn: async () => (await api.get(`/vendors/${active?.id}/availability/summary`)).data,
    retry: false,
    enabled: isVendor && Boolean(active?.id),
  });

  // A wedding planner is a provider who is not a vendor. Their dashboard opens
  // onto their clients rather than a shop window, so it carries an "action
  // required" band of the things waiting on them (EZ1-I39).
  const isPlanner = isProvider && !isVendor;
  const { data: plannerBook } = useQuery({
    queryKey: ['planner-clients-summary'],
    queryFn: async () =>
      (await api.get('/planner/clients')).data as {
        clients: { status: string }[];
        requests: unknown[];
      },
    retry: false,
    enabled: isPlanner,
  });
  const plannerClients = plannerBook?.clients ?? [];
  const activeClients = plannerClients.filter((c) => c.status === 'active').length;
  const upcomingClients = plannerClients.filter((c) => c.status === 'upcoming').length;
  const plannerRequests = plannerBook?.requests?.length ?? 0;

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
        {isBuyer && !isProvider && (
          <Counter label="Your bookings" value={myBookings?.total ?? 0} to="/bookings" />
        )}
      </div>

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
