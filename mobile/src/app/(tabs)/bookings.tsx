import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import {
  BOOKING_TABS,
  LIFECYCLE,
  isRequestOnDate,
  type IncomingBooking,
} from '@/lib/bookings';
import { Permission, canAny } from '@/shared/permissions';
import { FilterChips } from '@/components/chrome';
import { SelectField } from '@/components/form';
import { BookingCard } from '@/components/bookings/booking-card';
import { ListScreen } from '@/components/layout';
import { BusinessSwitcher } from '@/components/business/switcher';
import { Alert, Caption, Field, PageSubtitle, PageTitle } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { space } from '@/theme';

/**
 * The work coming in.
 *
 * The web client's BookingConsole and ProviderBookings as one screen. The tabs
 * count the whole queue rather than the page, the filtering is client-side
 * because a provider's queue is tens of rows and a round trip per keystroke
 * would be slower and worse, and the lifecycle is stated once at the top rather
 * than explained per row.
 *
 * The list is virtualised, which on this platform is not an optimisation but
 * the difference between a usable screen and an unusable one: each card carries
 * an image and, once opened, three nested queries. Mounting sixty of them at
 * once is what a ScrollView would do.
 */
export default function Bookings() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  // A planner answers an incoming request the same way a vendor does — with a
  // quotation — so both seller capabilities count. The server already lets
  // either one quote; checking only the vendor permission is what left a
  // planner with nothing but Decline on the web.
  const canQuote = canAny(permissions, [
    Permission.VENDOR_LISTING_MANAGE,
    Permission.PLANNER_LISTING_MANAGE,
  ]);

  const [tab, setTab] = useState<string | null>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'event'>('newest');
  const [error, setError] = useState('');

  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey: ['incoming-bookings'],
    queryFn: async () => (await api.get('/bookings/incoming', { params: { limit: 100 } })).data,
    retry: false,
  });

  const { data: counts } = useQuery({
    queryKey: ['incoming-counts'],
    queryFn: async () =>
      (await api.get('/bookings/incoming/counts')).data as Record<string, number>,
    retry: false,
  });

  const act = useMutation({
    mutationFn: async ({
      id,
      path,
      body,
    }: {
      id: string;
      path: string;
      body?: Record<string, unknown>;
    }) =>
      (await api.put(`/bookings/${id}/${path}`, body ?? (path === 'cancel' ? {} : undefined))).data,
    onSuccess: () => {
      // Accepting a job spends a window, so the calendar has to be refetched
      // alongside the booking list or the vendor sees a stale capacity.
      for (const key of [
        'incoming-bookings',
        'incoming-counts',
        'availability-slots',
        'availability-summary',
        'availability-calendar',
        'availability-bucket',
      ]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      setError('');
    },
    onError: (err) => setError(apiMessage(err, 'That action was rejected.')),
  });

  const all: IncomingBooking[] = data?.data ?? data?.items ?? [];

  const rows = useMemo(() => {
    const wanted = BOOKING_TABS.find((t) => t.key === tab)?.statuses ?? [];
    const term = search.trim().toLowerCase();

    const filtered = all.filter((booking) => {
      if (tab === 'request_on_date' && !isRequestOnDate(booking)) return false;
      if (wanted.length > 0 && !wanted.includes(booking.status)) return false;
      if (!term) return true;
      // Everything somebody might type: a couple, a booking reference, a
      // venue, a city, a service.
      return [
        booking.clientName,
        booking.clientEmail,
        booking.eventName,
        booking.eventVenue,
        booking.eventCity,
        booking.serviceName,
        booking.id,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term));
    });

    return [...filtered].sort((a, b) => {
      if (sort === 'event') {
        // Undated jobs last: they are the ones with nothing to plan around.
        if (!a.eventDate) return 1;
        if (!b.eventDate) return -1;
        return a.eventDate.localeCompare(b.eventDate);
      }
      const order = a.createdAt.localeCompare(b.createdAt);
      return sort === 'oldest' ? order : -order;
    });
  }, [all, tab, search, sort]);

  const chips = BOOKING_TABS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    count:
      // Counted from the rows for the derived tab, because the server counts
      // statuses and this tab is not one.
      entry.key === 'request_on_date'
        ? all.filter(isRequestOnDate).length
        : !counts
          ? undefined
          : entry.key === 'all'
            ? counts.all
            : entry.statuses.reduce((n, status) => n + (counts[status] ?? 0), 0),
  }));

  return (
    <ListScreen
      header={
        <>
          <View style={{ gap: space(1), marginTop: space(4) }}>
            <PageTitle>Bookings</PageTitle>
            <PageSubtitle>
              Everything coming in to your business, and the one thing each job is waiting on from
              you.
            </PageSubtitle>
          </View>

          <BusinessSwitcher />

          {error ? <Alert tone="critical">{error}</Alert> : null}

          {/* Null is not offered here: "All" is already the unfiltered view,
              so a chip that clears the filter would be a second All. */}
          <FilterChips options={chips} value={tab} onChange={(key) => setTab(key ?? 'all')} />

          <Field
            label="Search"
            value={search}
            onChangeText={setSearch}
            placeholder="Couple, venue, service or booking id"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <SelectField
            label="Order by"
            value={sort}
            onChange={(value) => setSort(value as typeof sort)}
            options={[
              { value: 'newest', label: 'Newest request' },
              { value: 'oldest', label: 'Oldest request' },
              { value: 'event', label: 'Wedding date' },
            ]}
          />

          {/*
            The lifecycle, once. Six section headings implied it and never said
            it, so a provider seeing "quotation_accepted" had to work out
            whether anything was expected of them next.
          */}
          <Caption tone="faint">{LIFECYCLE.join(' → ')}</Caption>
        </>
      }
      data={rows}
      keyExtractor={(booking) => booking.id}
      loading={isPending}
      refreshing={isFetching && !isPending}
      onRefresh={() => void refetch()}
      emptyTitle="Nothing here yet"
      emptyBody={
        search
          ? 'Nothing matches that search.'
          : 'Requests from couples arrive here. Publishing your availability and your prices is what makes them findable.'
      }
      renderItem={(booking) => (
        <BookingCard
          booking={booking}
          canQuote={canQuote}
          acting={act.isPending}
          onAct={(id, path, body) => act.mutate({ id, path, body })}
          onQuoted={() => {
            void qc.invalidateQueries({ queryKey: ['incoming-bookings'] });
            void qc.invalidateQueries({ queryKey: ['incoming-counts'] });
          }}
        />
      )}
    />
  );
}
