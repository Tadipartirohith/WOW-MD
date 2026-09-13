import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { SectionHeader, StatTile, TileGrid } from '@/components/chrome';
import { Body, Caption, Card, Loading, SectionTitle } from '@/components/ui';
import { space } from '@/theme';

/**
 * The individual's dashboard (EZ1-I261).
 *
 * The web dashboard for a person in the matches answers three questions in
 * order: is my profile finished, who is waiting on me, and what is coming up.
 * The same three, in the same order, and every figure opens the screen it is a
 * count of — a number nobody can act on is decoration.
 *
 * Nothing here is computed in the app beyond choosing what to show: the
 * completion percentage, the interest counts and the event list are the
 * server's own, from the endpoints those screens read.
 */
interface Completion {
  complete: boolean;
  percent: number;
  missing: string[];
}

interface Board {
  counts: Record<string, number>;
}

interface WeddingEvent {
  id: string;
  name: string;
  eventDate: string | null;
  venue: string | null;
  city: string | null;
}

export function IndividualHome({ profileId }: { profileId: string | null }) {
  const router = useRouter();

  const live = { retry: false, refetchOnMount: 'always' as const, refetchInterval: 60_000 };

  const completion = useQuery({
    queryKey: ['biodata-completion', profileId],
    enabled: Boolean(profileId),
    queryFn: async () =>
      (await api.get(`/profiles/${profileId}/details/completion`)).data as Completion,
    retry: false,
  });

  const board = useQuery({
    queryKey: ['interest-board'],
    queryFn: async () => (await api.get('/matches/interests')).data as Board,
    ...live,
  });

  const events = useQuery({
    queryKey: ['events'],
    queryFn: async () => (await api.get('/events', { params: { limit: 50 } })).data,
    retry: false,
  });

  const counts = board.data?.counts ?? {};
  const rows: WeddingEvent[] = events.data?.data ?? events.data?.items ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = rows
    .filter((row) => row.eventDate && row.eventDate >= today)
    .sort((a, b) => (a.eventDate ?? '').localeCompare(b.eventDate ?? ''))
    .slice(0, 3);

  return (
    <View style={{ gap: space(4) }}>
      {/*
        First, because a profile nobody can read is the reason nothing else on
        this screen is happening.
      */}
      {completion.data && !completion.data.complete ? (
        <Card>
          <SectionTitle>Your biodata is {completion.data.percent}% done</SectionTitle>
          <Body tone="muted">
            Families read the biodata before they decide whether to ask about you. Finishing it is
            the single thing that changes how often that happens.
          </Body>
          <StatTile
            label="Finish it"
            value={`${completion.data.missing.length} section${
              completion.data.missing.length === 1 ? '' : 's'
            } left`}
            tone="caution"
            onPress={() => router.push('/biodata')}
          />
        </Card>
      ) : null}

      <View style={{ gap: space(2) }}>
        <SectionHeader title="Interests" />
        {board.isLoading ? (
          <Loading rows={2} />
        ) : (
          <TileGrid>
            <StatTile
              label="Received"
              value={counts.received ?? 0}
              hint={counts.pending ? 'Some are waiting on you' : undefined}
              tone={counts.pending ? 'caution' : undefined}
              onPress={() => router.push('/interests')}
            />
            <StatTile label="Sent" value={counts.sent ?? 0} onPress={() => router.push('/interests')} />
            <StatTile
              label="Accepted"
              value={counts.accepted ?? 0}
              tone="positive"
              onPress={() => router.push('/interests')}
            />
            <StatTile label="Matches" value="Browse" onPress={() => router.push('/matches')} />
          </TileGrid>
        )}
      </View>

      <Card>
        <SectionTitle>Coming up</SectionTitle>
        {events.isLoading ? (
          <Loading rows={2} />
        ) : upcoming.length === 0 ? (
          <Caption tone="faint">No dated events yet.</Caption>
        ) : (
          upcoming.map((event) => (
            <View
              key={event.id}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}
            >
              <View style={{ flex: 1, gap: space(0.5) }}>
                <Body numberOfLines={1}>{event.name}</Body>
                <Caption tone="faint" numberOfLines={1}>
                  {[event.venue, event.city].filter(Boolean).join(', ') || 'Venue to be decided'}
                </Caption>
              </View>
              <Caption tone="faint">{shortDate(event.eventDate)}</Caption>
            </View>
          ))
        )}
        <StatTile label="Events" value="Open" onPress={() => router.push('/events')} />
      </Card>
    </View>
  );
}
