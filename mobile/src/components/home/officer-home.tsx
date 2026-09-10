import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { VerificationRequest } from '@/lib/verification';
import { SectionHeader, StatTile, TileGrid } from '@/components/chrome';
import { MyAvailability } from '@/components/verification/my-availability';
import { Sla } from '@/components/verification/sla';
import { Body, Caption, Card, Loading, SectionTitle } from '@/components/ui';
import { space } from '@/theme';

/**
 * The officer's home screen.
 *
 * Two questions, in the order somebody starting their day asks them: how much
 * is on me, and which of it is closest to its deadline. Both come off the same
 * endpoints the Verification tab uses, so the figures here and the queue behind
 * them cannot disagree.
 *
 * Availability is on this screen as well as inside Verification, deliberately.
 * Coming off the roster is the thing an officer is most likely to want from a
 * phone, and it should not need two taps to find.
 */
export function OfficerHome({ canFieldwork }: { canFieldwork: boolean }) {
  const router = useRouter();

  const { data: metrics, isLoading } = useQuery({
    queryKey: ['verification-metrics'],
    queryFn: async () => (await api.get('/verification/metrics')).data,
    retry: false,
    refetchInterval: 20_000,
  });

  const { data: requests } = useQuery({
    queryKey: ['verification-requests'],
    queryFn: async () => (await api.get('/verification/requests')).data,
    retry: false,
    refetchInterval: 20_000,
  });

  const { data: cases } = useQuery({
    queryKey: ['verification-cases'],
    queryFn: async () => (await api.get('/verification/cases')).data,
    retry: false,
    refetchInterval: 20_000,
  });

  const all: VerificationRequest[] = requests?.data ?? [];
  // What is genuinely on this officer's plate: allocated, out on it, or sent
  // back for a second visit. Approved and rejected are history.
  const mine = all.filter((request) =>
    ['assigned', 'in_progress', 'additional_review'].includes(request.status),
  );
  // Soonest deadline first, so the top row is the one that has to move today.
  // A visit with no deadline sorts last rather than first, which is what a
  // plain string compare on a null would have done.
  const next = [...mine]
    .sort((a, b) => (a.slaDeadline ?? '9999').localeCompare(b.slaDeadline ?? '9999'))
    .slice(0, 3);

  const openCases = (cases?.data ?? []).filter(
    (item: { status: string }) =>
      !['resolved', 'closed', 'rejected'].includes(item.status),
  ).length;

  return (
    <View style={{ gap: space(4) }}>
      {canFieldwork ? <MyAvailability /> : null}

      <View style={{ gap: space(2) }}>
        <SectionHeader title="Your queue" />
        {isLoading ? (
          <Loading rows={2} />
        ) : (
          <TileGrid>
            <StatTile
              label="On you now"
              value={mine.length}
              hint="Assigned, out, or sent back"
              tone={mine.length > 0 ? 'caution' : undefined}
              onPress={() => router.push('/verification')}
            />
            <StatTile
              label="Waiting to allocate"
              value={metrics?.requests?.new ?? 0}
              onPress={() => router.push('/verification')}
            />
            <StatTile
              label="Open cases"
              value={openCases}
              onPress={() => router.push('/cases')}
            />
            <StatTile
              label="Approved"
              value={metrics?.requests?.approved ?? 0}
              tone="positive"
              onPress={() => router.push('/verification')}
            />
          </TileGrid>
        )}
      </View>

      <Card>
        <SectionTitle>Closest to its deadline</SectionTitle>
        {next.length === 0 ? (
          <Caption tone="faint">Nothing is waiting on you right now.</Caption>
        ) : (
          next.map((request) => (
            <View key={request.id} style={{ gap: space(1.5) }}>
              <Body numberOfLines={2}>
                {request.subjectName ?? `${request.applicantType} verification`}
                {request.applicantCity ? ` · ${request.applicantCity}` : ''}
              </Body>
              <Sla request={request} />
            </View>
          ))
        )}
      </Card>
    </View>
  );
}
