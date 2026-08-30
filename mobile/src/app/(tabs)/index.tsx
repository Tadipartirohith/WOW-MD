import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';

import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { Permission, canAny } from '@/shared/permissions';
import {
  Body,
  Card,
  Caption,
  Eyebrow,
  Loading,
  PageSubtitle,
  PageTitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

/**
 * Home.
 *
 * The web dashboard's rule holds here and matters more on a phone: a screen
 * that only links to other screens tells you nothing you did not already know.
 * These are the numbers a person opens the app to find, and each one is chosen
 * by what their account can actually do.
 */
export default function Home() {
  const user = useAuth((s) => s.user);
  const permissions = user?.permissions ?? [];

  const isProvider = canAny(permissions, [Permission.BOOKING_READ_INCOMING]);
  const isBuyer = canAny(permissions, [Permission.BOOKING_READ_OWN]);

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

  // What a vendor opens the app to find out is how many people are waiting on
  // a price from them right now, not how many jobs they have ever had.
  const { data: newRequests } = useQuery({
    queryKey: ['new-requests-count'],
    queryFn: async () =>
      (await api.get('/bookings/incoming', { params: { limit: 1, status: 'requested' } })).data,
    retry: false,
    enabled: isProvider,
  });

  const { data: myBookings } = useQuery({
    queryKey: ['my-bookings-count'],
    queryFn: async () => (await api.get('/bookings', { params: { limit: 1 } })).data,
    retry: false,
    enabled: isBuyer,
  });

  const name: string | undefined = profile?.fullName ?? profile?.name;

  return (
    <Screen>
      <View style={{ gap: space(1), marginTop: space(4) }}>
        <Eyebrow>{greeting()}</Eyebrow>
        <PageTitle>{name ?? 'Welcome'}</PageTitle>
        <PageSubtitle>Here is where things stand today.</PageSubtitle>
      </View>

      {isPending ? (
        <Loading rows={2} />
      ) : (
        <View style={{ gap: space(3) }}>
          <Counter label="Unread notifications" value={unread?.count} />
          {isProvider ? <Counter label="Waiting on a price from you" value={newRequests?.total} /> : null}
          {isBuyer ? <Counter label="Your bookings" value={myBookings?.total} /> : null}
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
