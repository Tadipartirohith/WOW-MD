import { useState } from 'react';
import { FlatList, Image, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { Permission, can } from '@/shared/permissions';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Eyebrow,
  Loading,
  PageSubtitle,
  PageTitle,
  SectionTitle,
} from '@/components/ui';
import { radius, rgb, rgba, space, useTheme } from '@/theme';

interface PublicProfile {
  id: string;
  displayName: string;
  ageRange: string | null;
  city?: string;
  photos: string[];
  profileCode: string;
  verified: boolean;
  card?: {
    religion: string | null;
    motherTongue: string | null;
    profession: string | null;
  };
}

type InteractionState =
  | 'none'
  | 'interest_sent'
  | 'interest_received'
  | 'accepted'
  | 'declined_by_you'
  | 'declined_by_them';

interface Suggestion {
  profile: PublicProfile;
  score: number;
  interaction?: InteractionState;
  sharedByFamily?: { sharerEmail: string | null };
}

/**
 * Matches.
 *
 * The web page carries filters, a shortlist, a preview panel and paging. This
 * carries the list and the one action the list exists for, because a phone
 * screen that opens with six filter controls above the first result is a screen
 * that has decided browsing is a form-filling exercise.
 */
export default function Matches() {
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isAgent = can(permissions, Permission.AGENCY_MANAGE);
  const [error, setError] = useState('');
  const qc = useQueryClient();

  const { data, isPending, error: loadError } = useQuery({
    queryKey: ['suggestions'],
    queryFn: async () => (await api.get('/matches/suggestions', { params: { limit: 20 } })).data,
    retry: false,
  });

  const sendInterest = useMutation({
    mutationFn: (toProfileId: string) => api.post('/matches/interest', { toProfileId }),
    onSuccess: () => {
      setError('');
      void qc.invalidateQueries({ queryKey: ['suggestions'] });
    },
    onError: (err) => setError(apiMessage(err, 'That interest could not be sent.')),
  });

  const suggestions: Suggestion[] = data?.items ?? data ?? [];

  if (isPending) {
    return (
      <View style={{ flex: 1, padding: space(4), gap: space(4) }}>
        <Header />
        <Loading rows={3} />
      </View>
    );
  }

  return (
    <FlatList
      data={suggestions}
      keyExtractor={(s) => s.profile.id}
      contentContainerStyle={{ padding: space(4), gap: space(3), paddingBottom: space(12) }}
      ListHeaderComponent={
        <View style={{ gap: space(3), marginBottom: space(1) }}>
          <Header />
          {error ? <Alert tone="critical">{error}</Alert> : null}
          {loadError ? (
            <Alert tone="critical">
              {apiMessage(
                loadError,
                isAgent
                  ? 'Choose which client you are browsing for before matches can be suggested.'
                  : 'Matches could not be loaded.',
              )}
            </Alert>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        loadError ? null : (
          <EmptyState title="No matches to show yet">
            As more profiles are completed and verified, the ones worth your attention appear here.
          </EmptyState>
        )
      }
      renderItem={({ item }) => (
        <MatchCard
          suggestion={item}
          onSendInterest={() => sendInterest.mutate(item.profile.id)}
          busy={sendInterest.isPending && sendInterest.variables === item.profile.id}
        />
      )}
    />
  );
}

function Header() {
  return (
    <View style={{ gap: space(1), marginTop: space(4) }}>
      <PageTitle>Matches</PageTitle>
      <PageSubtitle>Suggested for you, most compatible first.</PageSubtitle>
    </View>
  );
}

/** What the interaction state means, said plainly rather than as a status word. */
const INTERACTION_LABEL: Partial<Record<InteractionState, string>> = {
  interest_sent: 'Interest sent',
  interest_received: 'They are interested in you',
  accepted: 'Matched',
  declined_by_you: 'You passed on this one',
  declined_by_them: 'Not taken forward',
};

function MatchCard({
  suggestion,
  onSendInterest,
  busy,
}: {
  suggestion: Suggestion;
  onSendInterest: () => void;
  busy: boolean;
}) {
  const theme = useTheme();
  const { profile, score, interaction } = suggestion;
  const cover = profile.photos?.[0];

  // Chips, not a comma-separated run-on: these are separate facts and a reader
  // scans them rather than reading them.
  const facts = [
    profile.ageRange,
    profile.city,
    profile.card?.profession,
    profile.card?.motherTongue,
  ].filter(Boolean) as string[];

  const settled = interaction && interaction !== 'none';

  return (
    <Card style={{ padding: 0, overflow: 'hidden', gap: 0 }}>
      <View style={{ aspectRatio: 3 / 2, backgroundColor: rgb(theme.surfaceSunken) }}>
        {cover ? (
          <Image source={{ uri: cover }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Caption tone="faint">No photograph yet</Caption>
          </View>
        )}
      </View>

      <View style={{ padding: space(4), gap: space(3) }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(3) }}>
          <View style={{ flex: 1, gap: space(0.5) }}>
            <SectionTitle numberOfLines={1}>{profile.displayName}</SectionTitle>
            <Eyebrow>{profile.profileCode}</Eyebrow>
          </View>
          {/*
            The number and its unit set apart, so "84" reads as the figure and
            "%" does not compete with it for the same weight.
          */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              backgroundColor: rgba(theme.brand, theme.dark ? 0.18 : 0.1),
              paddingHorizontal: space(2.5),
              paddingVertical: space(1),
              borderRadius: radius.sm,
            }}
          >
            <Body style={{ fontWeight: '600', fontVariant: ['tabular-nums'], color: rgb(theme.brandStrong) }}>
              {Math.round(score)}
            </Body>
            <Caption tone="brand" style={{ fontSize: 11 }}>
              %
            </Caption>
          </View>
        </View>

        {facts.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5) }}>
            {facts.map((fact) => (
              <View
                key={fact}
                style={{
                  backgroundColor: rgb(theme.surfaceSunken),
                  paddingHorizontal: space(2.5),
                  paddingVertical: space(1),
                  borderRadius: radius.sm,
                }}
              >
                <Caption>{fact}</Caption>
              </View>
            ))}
          </View>
        ) : null}

        {suggestion.sharedByFamily ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
            <CheckCircle size={15} color={rgb(theme.positiveFg)} weight="fill" />
            <Caption>Sent over by your family</Caption>
          </View>
        ) : null}

        {settled ? (
          <Body tone="muted">{INTERACTION_LABEL[interaction] ?? 'Already actioned'}</Body>
        ) : (
          <Button label="Send interest" onPress={onSendInterest} busy={busy} small />
        )}
      </View>
    </Card>
  );
}
