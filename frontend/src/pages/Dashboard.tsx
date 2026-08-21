import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { Permission, PermissionValue, ROLE_LABEL, canAny } from '../lib/permissions';
import { ReactNode } from 'react';

interface Tile {
  to: string;
  title: string;
  desc: string;
  requires: PermissionValue[];
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
  },
  {
    to: '/vendors',
    title: 'Vendors',
    desc: 'Browse venues, catering, photography and more',
    requires: [Permission.BOOKING_CREATE],
  },
  {
    to: '/wedding-planners',
    title: 'Wedding Planners',
    desc: 'Find a planner to run your wedding end to end',
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
    title: 'Wedding Planner',
    desc: 'Auto-generated timeline and tasks',
    requires: [Permission.PLAN_MANAGE_OWN, Permission.PLAN_MANAGE_ENGAGED],
  },
  {
    to: '/bookings',
    title: 'Bookings',
    desc: 'Manage bookings and escrow',
    requires: [Permission.BOOKING_READ_OWN],
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

  const tiles = TILES.filter((t) => t.requires.length === 0 || canAny(permissions, t.requires));

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
      <div className="grid gap-3 sm:grid-cols-3">
        <Counter
          label="Unread notifications"
          value={unread?.unread ?? 0}
          to="/notifications"
        />
        {isProvider && (
          <>
            <Counter label="Bookings against your listing" value={incoming?.total ?? 0} to="/bookings" />
            <Counter
              label="Held in escrow"
              value={`\u20b9${Number(earnings?.heldInEscrow ?? 0).toLocaleString('en-IN')}`}
              to="/accounts"
            />
          </>
        )}
        {isBuyer && !isProvider && (
          <Counter label="Your bookings" value={myBookings?.total ?? 0} to="/bookings" />
        )}
      </div>

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
}: {
  label: string;
  value: ReactNode;
  to: string;
}) {
  return (
    <Link to={to} className="card transition hover:shadow-md">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className="mt-1 text-2xl font-semibold text-gray-900"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </p>
    </Link>
  );
}
