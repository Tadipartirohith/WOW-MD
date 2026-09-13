import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';

import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { Permission, canAny } from '@/shared/permissions';
import { IndividualHome } from '@/components/home/individual-home';
import { NotificationBell } from '@/components/home/notification-bell';
import { OfficerHome } from '@/components/home/officer-home';
import { ProviderHome } from '@/components/home/provider-home';
import {
  Body,
  Caption,
  Card,
  Eyebrow,
  Loading,
  PageSubtitle,
  PageTitle,
  Screen,
} from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

/**
 * Home.
 *
 * The web dashboard's rule holds here and matters more on a phone: a screen
 * that only links to other screens tells you nothing you did not already know.
 * These are the numbers a person opens the app to find, and which ones they are
 * is decided by what their account can actually do — the same capability test
 * the sidebar uses, not a role string.
 *
 * A provider and an officer each get their own dashboard, because the web app
 * has two of them (VendorDashboard and the Verification metrics) and they answer
 * different questions. A buyer or an agent gets the counters this screen has
 * always carried.
 */
export default function Home() {
  const user = useAuth((s) => s.user);
  const permissions = user?.permissions ?? [];

  const isProvider = canAny(permissions, [Permission.BOOKING_READ_INCOMING]);
  const isOfficer = canAny(permissions, [
    Permission.VERIFICATION_PROCESS,
    Permission.VERIFICATION_ALLOCATE,
    Permission.VERIFICATION_FIELDWORK,
  ]);
  const canFieldwork = canAny(permissions, [Permission.VERIFICATION_FIELDWORK]);
  // Exactly the test the tab bar uses to withhold the Alerts tab, so the bell
  // appears for the personas that lost the tab and for nobody else.
  const noAlertsTab = canAny(permissions, [
    Permission.VENDOR_LISTING_MANAGE,
    Permission.PLANNER_LISTING_MANAGE,
  ]);
  const isBuyer = canAny(permissions, [Permission.BOOKING_READ_OWN]);
  // Somebody who is in the matches themselves, as opposed to an agent running
  // other people's (EZ1-I261).
  const isIndividual =
    canAny(permissions, [Permission.MATCH_BROWSE]) &&
    !canAny(permissions, [Permission.AGENCY_MANAGE]);
  const isAgent = canAny(permissions, [Permission.AGENCY_MANAGE]);

  const { data: profile, isPending } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
    retry: false,
  });

  const { data: unread } = useQuery({
    queryKey: ['unread-count'],
    queryFn: async () => (await api.get('/notifications/unread-count')).data,
    retry: false,
  });

  // Booking buckets from the dedicated counts endpoint, matching the web
  // dashboard rather than reading .total off a one-row list.
  const { data: bookingCounts } = useQuery({
    queryKey: ['my-booking-counts'],
    queryFn: async () =>
      (await api.get('/bookings/counts')).data as {
        all: number;
        active: number;
        cancelled: number;
        completed: number;
      },
    retry: false,
    enabled: isBuyer,
  });

  // The agent's book at a glance.
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

  // `displayName` is the only name /users/me returns -- the Profile entity has
  // no `fullName` or `name`, so both of the fields read here were always
  // undefined and every persona was greeted "Welcome" (council round 2).
  const name: string | undefined = profile?.displayName;

  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: space(2),
          marginTop: space(4),
        }}
      >
        <View style={{ flex: 1, gap: space(1) }}>
          <Eyebrow>{greeting()}</Eyebrow>
          <PageTitle>{name ?? 'Welcome'}</PageTitle>
          <PageSubtitle>Here is where things stand today.</PageSubtitle>
        </View>
        {/* A provider's bar has no Alerts tab, so the count comes here instead
            of hiding behind More (EZ1-I255). */}
        {noAlertsTab ? <NotificationBell /> : null}
      </View>

      {isPending ? (
        <Loading rows={2} />
      ) : (
        <View style={{ gap: space(4) }}>
          {isProvider ? <ProviderHome /> : null}
          {isOfficer ? <OfficerHome canFieldwork={canFieldwork} /> : null}
          {isIndividual ? <IndividualHome profileId={profile?.id ?? null} /> : null}

          {/* The counters this screen has always carried, for the accounts that
              are neither selling nor verifying. */}
          {!isProvider && !isOfficer && !isIndividual ? (
            <View style={{ gap: space(3) }}>
              <Counter label="Unread notifications" value={unread?.unread} />
              {isBuyer ? (
                <>
                  <Counter label="My bookings" value={bookingCounts?.all} />
                  <Counter label="Active bookings" value={bookingCounts?.active} />
                  <Counter label="Completed bookings" value={bookingCounts?.completed} />
                  <Counter label="Cancelled bookings" value={bookingCounts?.cancelled} />
                </>
              ) : null}
              {isAgent ? (
                <>
                  <Counter label="Total clients" value={agentStats?.totalClients} />
                  <Counter label="Matches fixed" value={agentStats?.matchesFixed} />
                  <Counter label="Remaining clients" value={agentStats?.remainingClients} />
                  <Counter label="Total interests" value={agentStats?.totalInterests} />
                </>
              ) : null}
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * A number, set large and in the same tabular figures the web app uses.
 *
 * An absent count is drawn as a dash rather than a nought: nought is a fact,
 * and claiming it before the answer has arrived is the small lie that makes
 * somebody stop trusting the screen.
 */
function Counter({ label, value }: { label: string; value?: number }) {
  const theme = useTheme();
  return (
    <Card style={{ gap: space(1.5) }}>
      <Caption numberOfLines={1}>{label}</Caption>
      {/*
        Tabular figures. These sit in a column and get compared against each
        other, and proportional digits make a column of numbers ripple. The web
        app sets a mono face for the same reason; the figures are the part that
        matters, and a mono family here would just be a different face on each
        platform.
      */}
      <Body
        style={{
          fontSize: 30,
          fontWeight: '500',
          lineHeight: 32,
          letterSpacing: -0.6,
          fontVariant: ['tabular-nums'],
          color: rgb(theme.ink[900]),
        }}
      >
        {value ?? '—'}
      </Body>
    </Card>
  );
}
