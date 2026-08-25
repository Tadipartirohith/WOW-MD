import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { useBusinesses } from '../store/business';
import { Permission, PermissionValue, ROLE_LABEL, UserRole, canAny } from '../lib/permissions';
import { ReactNode } from 'react';
import ClaimRequests from '../components/ClaimRequests';

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
  },
  {
    to: '/shared-with-me',
    title: 'Shared With Me',
    desc: 'Biodata other agencies have circulated to you',
    requires: [Permission.ACT_ON_BEHALF],
  },
  {
    to: '/pool',
    title: 'Network Pool',
    desc: 'Profiles other approved agencies have opened to the network',
    requires: [Permission.NETWORK_POOL_BROWSE],
  },
  {
    to: '/proposals',
    title: 'Proposals',
    desc: 'Talk through a pairing with the agent on the other side',
    requires: [Permission.ACT_ON_BEHALF],
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
    hideFor: ['vendor'],
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

  const tiles = TILES.filter(
    (t) =>
      !(user && t.hideFor?.includes(user.role)) &&
      (t.requires.length === 0 || canAny(permissions, t.requires)),
  );

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-brand p-6 text-white">
        <h1 className="text-2xl font-bold">Welcome to WOW</h1>
        <p className="opacity-90">
          Signed in as <strong>{user ? (ROLE_LABEL[user.role] ?? user.role) : ''}</strong>
          {user?.managedByAgentId ? ' · represented by an agent' : ''}.{' '}
          {profile?.profileCompleted
            ? 'Your profile is complete.'
            : 'Finish your profile to unlock everything below.'}
        </p>
      </div>
      <ClaimRequests />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Counter
          label="Unread notifications"
          value={unread?.unread ?? 0}
          to="/notifications"
        />
        {isProvider && (
          <>
            <Counter
              label="New requests"
              value={newRequests?.total ?? 0}
              to="/bookings"
              tone={(newRequests?.total ?? 0) > 0 ? 'text-amber-700' : undefined}
            />
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className="card transition hover:shadow-md">
            <h2 className="font-semibold text-brand-dark">{t.title}</h2>
            <p className="mt-1 text-sm text-gray-600">{t.desc}</p>
          </Link>
        ))}
      </div>
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
    <Link to={to} className="card transition hover:shadow-md">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${tone ?? 'text-gray-900'}`}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </p>
    </Link>
  );
}
