import { useState } from 'react';
import { Share, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarBlank, MapPin, UsersThree } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { todayIso } from '@/shared/dates';
import { Badge, StatTile, TileGrid } from '@/components/chrome';
import { DateField, TimeField } from '@/components/form';
import { ListScreen } from '@/components/layout';
import {
  Alert,
  Button,
  Caption,
  Card,
  Field,
  PageSubtitle,
  PageTitle,
  SectionTitle,
} from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

/**
 * The wedding's own days (EZ1-I261).
 *
 * A wedding is not one event: it is a mehendi, a haldi, a reception and the
 * ceremony itself, each with its own day, venue and guest list, and every
 * booking on this platform hangs off one of them. The app could show a vendor
 * the event a booking was for and gave the couple no way to create or read one.
 *
 * Sharing is the part that matters most on a phone, and the part EZ1-I178 was
 * about: the link comes back from the server built on the deployed base URL,
 * and goes straight into the phone's own share sheet — which is where somebody
 * is when they think "send this to my cousin".
 */
interface WeddingEvent {
  id: string;
  name: string;
  eventDate: string | null;
  startTime: string | null;
  venue: string | null;
  city: string | null;
  expectedGuests: number | null;
  status: string;
  category: string | null;
}

interface Summary {
  total: number;
  upcoming: number;
  completed: number;
  cancelled: number;
}

export default function Events() {
  const theme = useTheme();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey: ['events'],
    queryFn: async () => (await api.get('/events', { params: { limit: 50 } })).data,
    retry: false,
  });

  const { data: summary } = useQuery({
    queryKey: ['events-summary'],
    queryFn: async () => (await api.get('/events/summary')).data as Summary,
    retry: false,
  });

  const share = useMutation({
    mutationFn: async (eventId: string) =>
      (await api.post(`/events/${eventId}/share-link`, {})).data as { url: string },
    onSuccess: async (link, eventId) => {
      setError('');
      const event = rows.find((row) => row.id === eventId);
      /*
       * The phone's own share sheet, not a "copied" toast. Somebody asking for
       * an invitation link is already thinking of the person they are sending
       * it to, and WhatsApp is one tap from here.
       */
      await Share.share({
        message: `You are invited to ${event?.name ?? 'our wedding'}: ${link.url}`,
      });
    },
    onError: (err) => setError(apiMessage(err, 'That link could not be created.')),
  });

  const rows: WeddingEvent[] = data?.data ?? data?.items ?? [];

  return (
    <ListScreen
      header={
        <>
          <View style={{ gap: space(1) }}>
            <PageTitle>Events</PageTitle>
            <PageSubtitle>
              Every day of the wedding, with its own date, venue and guests. Bookings hang off these.
            </PageSubtitle>
          </View>

          {notice ? <Alert tone="positive">{notice}</Alert> : null}
          {error ? <Alert tone="critical">{error}</Alert> : null}

          {summary ? (
            <TileGrid>
              <StatTile label="All events" value={summary.total} />
              <StatTile label="Upcoming" value={summary.upcoming} tone="brand" />
              <StatTile label="Completed" value={summary.completed} tone="positive" />
              <StatTile label="Cancelled" value={summary.cancelled} />
            </TileGrid>
          ) : null}

          <Button
            label={creating ? 'Cancel' : 'Add an event'}
            variant={creating ? 'outline' : 'primary'}
            onPress={() => setCreating((open) => !open)}
          />

          {creating ? (
            <NewEvent
              onCancel={() => setCreating(false)}
              onCreated={() => {
                setCreating(false);
                setError('');
                setNotice('Added. Vendors can be booked against it now.');
                void qc.invalidateQueries({ queryKey: ['events'] });
                void qc.invalidateQueries({ queryKey: ['events-summary'] });
              }}
              onError={setError}
            />
          ) : null}
        </>
      }
      data={rows}
      keyExtractor={(row) => row.id}
      loading={isPending}
      refreshing={isFetching && !isPending}
      onRefresh={() => void refetch()}
      emptyTitle="No events yet"
      emptyBody="Add the mehendi, the reception, the ceremony — whichever days you are planning."
      renderItem={(row) => (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
            <SectionTitle style={{ flex: 1 }} numberOfLines={2}>
              {row.name}
            </SectionTitle>
            <Badge tone={row.status === 'cancelled' ? 'critical' : 'brand'}>
              {row.status.replace(/_/g, ' ')}
            </Badge>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(3) }}>
            <Fact icon={<CalendarBlank size={14} color={rgb(theme.ink[400])} />}>
              {[shortDate(row.eventDate), row.startTime].filter(Boolean).join(' · ')}
            </Fact>
            {row.venue || row.city ? (
              <Fact icon={<MapPin size={14} color={rgb(theme.ink[400])} />}>
                {[row.venue, row.city].filter(Boolean).join(', ')}
              </Fact>
            ) : null}
            {row.expectedGuests ? (
              <Fact icon={<UsersThree size={14} color={rgb(theme.ink[400])} />}>
                {`${row.expectedGuests} guests`}
              </Fact>
            ) : null}
          </View>

          <Button
            label="Share the invitation"
            variant="outline"
            small
            busy={share.isPending}
            onPress={() => share.mutate(row.id)}
          />
        </Card>
      )}
    />
  );
}

function Fact({ icon, children }: { icon: React.ReactNode; children: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
      {icon}
      <Caption>{children}</Caption>
    </View>
  );
}

/**
 * A new day of the wedding.
 *
 * The name is the only thing demanded. A family adding "Reception" three months
 * out does not yet know the venue, and a form that insists on one is a form
 * they close.
 */
function NewEvent({
  onCancel,
  onCreated,
  onError,
}: {
  onCancel: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    name: '',
    eventDate: '',
    startTime: '',
    venue: '',
    city: '',
    expectedGuests: '',
  });

  const create = useMutation({
    mutationFn: async () => {
      await api.post('/events', {
        name: form.name.trim(),
        ...(form.eventDate ? { eventDate: form.eventDate } : {}),
        ...(form.startTime ? { startTime: form.startTime } : {}),
        ...(form.venue.trim() ? { venue: form.venue.trim() } : {}),
        ...(form.city.trim() ? { city: form.city.trim() } : {}),
        ...(form.expectedGuests ? { expectedGuests: Number(form.expectedGuests) } : {}),
      });
    },
    onSuccess: onCreated,
    onError: (err) => onError(apiMessage(err, 'That event could not be added.')),
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <Card>
      <Field
        label="What is it?"
        value={form.name}
        onChangeText={set('name')}
        placeholder="Reception, Mehendi, Wedding ceremony"
      />
      {/* A wedding is planned, not recorded: the day being added has not
          happened yet. */}
      <DateField label="Day" value={form.eventDate} onChange={set('eventDate')} from={todayIso()} />
      <TimeField label="Starts" value={form.startTime} onChange={set('startTime')} />
      <Field label="Venue" value={form.venue} onChangeText={set('venue')} />
      <Field label="City" value={form.city} onChangeText={set('city')} />
      <Field
        label="Guests expected"
        value={form.expectedGuests}
        onChangeText={set('expectedGuests')}
        keyboardType="number-pad"
        maxLength={5}
      />
      <View style={{ gap: space(2) }}>
        <Button
          label="Add the event"
          busy={create.isPending}
          disabled={!form.name.trim()}
          onPress={() => create.mutate()}
        />
        <Button label="Cancel" variant="outline" onPress={onCancel} />
      </View>
    </Card>
  );
}
