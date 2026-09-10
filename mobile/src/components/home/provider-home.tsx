import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { BUSINESS_STATUS_LABEL, businessTone } from '@/lib/business-status';
import { rupees, shortDate } from '@/lib/format';
import { BOOKING_STATUS_LABEL } from '@/shared/permissions';
import { Badge, SectionHeader, StatTile, TileGrid } from '@/components/chrome';
import { BusinessSwitcher } from '@/components/business/switcher';
import { Body, Caption, Card, Loading, SectionTitle } from '@/components/ui';
import { useBusinesses } from '@/store/business';
import { rgb, space, useTheme } from '@/theme';

interface Earnings {
  heldInEscrow: string;
  pendingPayout: string;
  released: string;
  currency: string;
  ledger: { status: string; payoutAmount: string; confirmedAt: string | null; createdAt: string }[];
}

interface IncomingBooking {
  id: string;
  status: string;
  amount: string;
  eventDate: string | null;
  createdAt: string;
  clientName: string | null;
  eventName: string | null;
  eventVenue: string | null;
  eventCity: string | null;
  serviceName: string | null;
}

/** In-flight: everything that is neither finished nor called off. */
const CLOSED = ['completed', 'cancelled', 'disputed'];

/**
 * The provider's home screen.
 *
 * Every figure is read live from the same endpoints the rest of the portal uses
 * — booking counts, the escrow ledger, the reviews aggregate, availability,
 * notifications — so nothing here is hardcoded and a vendor only ever sees
 * their own account: each endpoint scopes to the listings the caller owns on the
 * server.
 *
 * "Live" is refetch-on-focus plus a poll plus the invalidations the booking
 * actions already fire, exactly as on the web. This app has no socket for it
 * and does not pretend otherwise.
 *
 * The web dashboard also draws a bookings-over-time chart. It is not here: a
 * chart that has to be legible at 360 points wide either loses its axis or
 * loses its detail, and the figures underneath it answer the same question. It
 * is the one deliberate omission from this screen.
 */
export function ProviderHome() {
  const theme = useTheme();
  const router = useRouter();
  const { active, businesses, activeId } = useBusinesses();

  // Poll while open and refetch when the app regains focus, so a new request or
  // a released payout appears without a manual refresh.
  const live = {
    retry: false,
    refetchOnMount: 'always' as const,
    refetchInterval: 30_000,
  };

  const counts = useQuery({
    queryKey: ['incoming-counts'],
    queryFn: async () =>
      (await api.get('/bookings/incoming/counts')).data as Record<string, number>,
    ...live,
  });

  const earnings = useQuery({
    queryKey: ['earnings'],
    queryFn: async () => (await api.get('/bookings/earnings')).data as Earnings,
    ...live,
  });

  const incoming = useQuery({
    queryKey: ['incoming-bookings'],
    queryFn: async () =>
      (await api.get('/bookings/incoming', { params: { limit: 100 } })).data as {
        data: IncomingBooking[];
      },
    ...live,
  });

  const vendorRows = useQuery({
    queryKey: ['vendor-me'],
    queryFn: async () =>
      (await api.get('/vendors/me')).data as { id: string; ratingAvg: number; ratingCount: number }[],
    retry: false,
  });

  const slots = useQuery({
    queryKey: ['availability-summary', activeId],
    queryFn: async () =>
      (await api.get(`/vendors/${activeId}/availability/summary`)).data as { openSlots: number },
    enabled: Boolean(activeId),
    retry: false,
  });

  const c = counts.data ?? {};
  const all = c.all ?? 0;
  const completed = c.completed ?? 0;
  const cancelled = c.cancelled ?? 0;
  const requested = c.requested ?? 0;
  const activeCount = Math.max(0, all - completed - cancelled);

  const bookings = incoming.data?.data ?? [];
  const upcoming = bookings
    .filter((b) => b.eventDate && b.eventDate >= new Date().toISOString().slice(0, 10))
    .sort((a, b) => (a.eventDate ?? '').localeCompare(b.eventDate ?? ''))
    .slice(0, 5);
  const recent = [...bookings]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  // This month's earnings, from the escrow ledger: released payouts confirmed
  // (or, failing a confirmation timestamp, created) in the current month.
  const now = new Date();
  const thisMonth = (earnings.data?.ledger ?? []).reduce((sum, payment) => {
    if (payment.status !== 'released') return sum;
    const at = new Date(payment.confirmedAt ?? payment.createdAt);
    if (at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth()) {
      return sum + Number(payment.payoutAmount || 0);
    }
    return sum;
  }, 0);

  const row = vendorRows.data?.find((v) => v.id === activeId);
  const ratingAvg = row?.ratingAvg ?? 0;
  const ratingCount = row?.ratingCount ?? 0;

  return (
    <View style={{ gap: space(4) }}>
      <BusinessSwitcher />

      {active ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
            <SectionTitle style={{ flex: 1 }} numberOfLines={2}>
              {active.name}
            </SectionTitle>
            <Badge tone={businessTone(active.status)}>
              {active.isApproved
                ? 'Live in search'
                : (BUSINESS_STATUS_LABEL[active.status] ?? active.status.replace(/_/g, ' '))}
            </Badge>
          </View>
          {businesses.length > 1 ? (
            <Caption tone="faint">{businesses.length} businesses · switch above</Caption>
          ) : null}
        </Card>
      ) : null}

      <View style={{ gap: space(2) }}>
        <SectionHeader title="Bookings" />
        {counts.isLoading ? (
          <Loading rows={2} />
        ) : (
          <TileGrid>
            {/* Each tile opens the queue. A number nobody can act on is
                decoration. */}
            <StatTile label="Total bookings" value={all} onPress={() => router.push('/bookings')} />
            <StatTile
              label="New requests"
              value={requested}
              tone={requested > 0 ? 'caution' : undefined}
              hint={requested > 0 ? 'Waiting on a price from you' : undefined}
              onPress={() => router.push('/bookings')}
            />
            <StatTile label="Active" value={activeCount} onPress={() => router.push('/bookings')} />
            <StatTile
              label="Completed"
              value={completed}
              onPress={() => router.push('/bookings')}
            />
          </TileGrid>
        )}
      </View>

      <View style={{ gap: space(2) }}>
        <SectionHeader title="Money" />
        {earnings.isLoading ? (
          <Loading rows={2} />
        ) : (
          <TileGrid>
            <StatTile
              label="Earnings this month"
              value={rupees(thisMonth)}
              onPress={() => router.push('/accounts')}
            />
            <StatTile
              label="Held in escrow"
              value={rupees(earnings.data?.heldInEscrow ?? 0)}
              hint="Yours once the work is signed off"
              onPress={() => router.push('/accounts')}
            />
            <StatTile
              label="Pending payouts"
              value={rupees(earnings.data?.pendingPayout ?? 0)}
              tone={Number(earnings.data?.pendingPayout ?? 0) > 0 ? 'caution' : undefined}
              onPress={() => router.push('/accounts')}
            />
            <StatTile
              label="Total paid out"
              value={rupees(earnings.data?.released ?? 0)}
              onPress={() => router.push('/accounts')}
            />
          </TileGrid>
        )}
      </View>

      <TileGrid>
        <StatTile
          label="Average rating"
          value={ratingCount > 0 ? `${ratingAvg.toFixed(1)} ★` : 'No reviews'}
          hint={
            ratingCount > 0
              ? `${ratingCount} review${ratingCount === 1 ? '' : 's'}`
              : 'Arrive with completed jobs'
          }
        />
        <StatTile
          label="Open windows"
          value={slots.data?.openSlots}
          hint="Can still take a booking"
          onPress={() => router.push('/availability')}
        />
      </TileGrid>

      {/* The whole queue by state, so the shape of the work is legible without
          opening the list. */}
      {all > 0 && (
        <Card>
          <SectionTitle>Booking status</SectionTitle>
          {Object.entries(BOOKING_STATUS_LABEL)
            .filter(([status]) => (c[status] ?? 0) > 0)
            .map(([status, label]) => (
              <View
                key={status}
                style={{ flexDirection: 'row', alignItems: 'center', gap: space(2.5) }}
              >
                <Caption style={{ flex: 1 }} numberOfLines={1}>
                  {label}
                </Caption>
                <View
                  style={{
                    flex: 1.2,
                    height: 6,
                    borderRadius: 3,
                    overflow: 'hidden',
                    backgroundColor: rgb(theme.surfaceSunken),
                  }}
                >
                  <View
                    style={{
                      height: '100%',
                      borderRadius: 3,
                      width: `${((c[status] ?? 0) / all) * 100}%`,
                      backgroundColor: rgb(theme.brand),
                    }}
                  />
                </View>
                <Caption style={{ width: 28, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
                  {c[status] ?? 0}
                </Caption>
              </View>
            ))}
        </Card>
      )}

      <BookingList
        title="Upcoming bookings & events"
        bookings={upcoming}
        loading={incoming.isLoading}
        empty="No dated bookings coming up."
        dateOf={(booking) => booking.eventDate}
      />

      <BookingList
        title="Recent bookings"
        bookings={recent}
        loading={incoming.isLoading}
        empty="No bookings yet."
        dateOf={(booking) => booking.createdAt}
      />
    </View>
  );
}

function BookingList({
  title,
  bookings,
  loading,
  empty,
  dateOf,
}: {
  title: string;
  bookings: IncomingBooking[];
  loading: boolean;
  empty: string;
  dateOf: (booking: IncomingBooking) => string | null;
}) {
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      {loading ? (
        <Loading rows={2} />
      ) : bookings.length === 0 ? (
        <Caption tone="faint">{empty}</Caption>
      ) : (
        bookings.map((booking) => (
          <View
            key={booking.id}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}
          >
            <View style={{ flex: 1, gap: space(0.5) }}>
              <Body numberOfLines={1}>
                {booking.clientName ?? 'Customer'}
                {booking.serviceName ? ` · ${booking.serviceName}` : ''}
              </Body>
              <Caption tone="faint" numberOfLines={1}>
                {[booking.eventName, [booking.eventVenue, booking.eventCity].filter(Boolean).join(', ')]
                  .filter(Boolean)
                  .join(' · ') ||
                  BOOKING_STATUS_LABEL[booking.status] ||
                  booking.status}
              </Caption>
            </View>
            <Caption tone="faint">{shortDate(dateOf(booking))}</Caption>
          </View>
        ))
      )}
    </Card>
  );
}
