import { View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, CircleDashed } from 'phosphor-react-native';

import { api } from '@/lib/api';
import { HoroscopeSection } from '@/components/biodata/horoscope-section';
import { PreferencesSection } from '@/components/biodata/preferences-section';
import { DetailGrid, DetailRow } from '@/components/chrome';
import { MediaStrip, PhotoPicker } from '@/components/uploader';
import {
  Body,
  Caption,
  Card,
  Loading,
  PageSubtitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

/**
 * The biodata, on a phone (EZ1-I261).
 *
 * The web page is ten sections of form. This is not a transcription of it: a
 * ten-section form on a phone is a form people abandon in the third section,
 * and the parts of a biodata that actually change after it is first written are
 * few. So this screen answers the three questions somebody opens it with —
 * how far am I, what does it say about me, and can I fix the two things that
 * move — and says plainly where the rest is edited.
 *
 * What is editable here is what a family changes with the phone in their hand:
 * the photographs, the horoscope chart (which is usually a picture taken of a
 * piece of paper), and the partner preferences, which are the thing people
 * revise as the search goes on.
 *
 * Completeness is computed by the server from what is stored, so it cannot
 * drift from the truth the way a stored "complete" flag would.
 */
interface Completion {
  profileId: string;
  complete: boolean;
  percent: number;
  sections: { section: string; complete: boolean; label: string }[];
  missing: string[];
}

export default function Biodata() {
  const theme = useTheme();
  const qc = useQueryClient();

  // Whose biodata. An individual acts as themselves; the id comes from the
  // profile the account owns rather than being asked for.
  const { data: me, isPending: loadingMe } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data as { id?: string | null },
    retry: false,
  });
  // `/users/me` answers with the profile itself, so its id is the profile id.
  const profileId = me?.id ?? null;

  const { data: completion } = useQuery({
    queryKey: ['biodata-completion', profileId],
    enabled: Boolean(profileId),
    queryFn: async () =>
      (await api.get(`/profiles/${profileId}/details/completion`)).data as Completion,
    retry: false,
  });

  const { data: details, isPending } = useQuery({
    queryKey: ['biodata-details', profileId],
    enabled: Boolean(profileId),
    queryFn: async () => (await api.get(`/profiles/${profileId}/details`)).data,
    retry: false,
  });

  const { data: photos } = useQuery({
    queryKey: ['biodata-photos', profileId],
    enabled: Boolean(profileId),
    queryFn: async () =>
      (await api.get(`/profiles/${profileId}/details/photos`)).data as { photos: string[] },
    retry: false,
  });

  if (loadingMe || (profileId && isPending)) {
    return (
      <Screen>
        <Loading rows={4} />
      </Screen>
    );
  }

  if (!profileId) {
    return (
      <Screen>
        <Card>
          <SectionTitle>No profile yet</SectionTitle>
          <Body tone="muted">
            This account has no matrimony profile. An agent creates one for the clients on their
            book; an individual gets one on sign-up.
          </Body>
        </Card>
      </Screen>
    );
  }

  const d = (details ?? {}) as Record<string, unknown>;
  const text = (key: string): string => {
    const value = d[key];
    return typeof value === 'string' && value.trim() ? value : '—';
  };
  const bag = (key: string): Record<string, unknown> =>
    (d[key] as Record<string, unknown> | undefined) ?? {};

  const refresh = () => {
    for (const key of ['biodata-details', 'biodata-completion', 'biodata-photos']) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  return (
    <Screen>
      <PageSubtitle>
        What families read before they decide whether to ask about you. The more of it there is, the
        more often that happens.
      </PageSubtitle>

      {completion ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(2) }}>
            <SectionTitle style={{ flex: 1 }}>
              {completion.complete ? 'Complete' : 'Still to finish'}
            </SectionTitle>
            <Body style={{ fontWeight: '600', fontVariant: ['tabular-nums'] }}>
              {completion.percent}%
            </Body>
          </View>
          <View
            style={{
              height: 6,
              borderRadius: 3,
              overflow: 'hidden',
              backgroundColor: rgb(theme.surfaceSunken),
            }}
          >
            <View
              style={{
                height: '100%',
                width: `${completion.percent}%`,
                backgroundColor: rgb(theme.brand),
              }}
            />
          </View>
          {completion.sections.map((section) => (
            <View
              key={section.section}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}
            >
              {section.complete ? (
                <CheckCircle size={16} weight="fill" color={rgb(theme.positiveFg)} />
              ) : (
                <CircleDashed size={16} color={rgb(theme.ink[400])} />
              )}
              <Caption tone={section.complete ? 'muted' : 'default'}>{section.label}</Caption>
            </View>
          ))}
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Photographs</SectionTitle>
        <Body tone="muted">
          A profile with photographs is asked about several times more often than one without.
        </Body>
        <MediaStrip
          urls={photos?.photos ?? []}
          onRemove={(url) => {
            void api
              .delete(`/profiles/${profileId}/details/photos`, { data: { url } })
              .then(refresh);
          }}
        />
        <PhotoPicker
          label="Add a photograph"
          onUploaded={(url) => {
            void api.post(`/profiles/${profileId}/details/photos`, { url }).then(refresh);
          }}
        />
      </Card>

      <Card>
        <SectionTitle>Personal</SectionTitle>
        <DetailGrid>
          <DetailRow label="Name">
            {[text('firstName'), text('lastName')].filter((v) => v !== '—').join(' ') || '—'}
          </DetailRow>
          <DetailRow label="Date of birth">{text('dateOfBirth')}</DetailRow>
          <DetailRow label="Height">
            {typeof d.heightCm === 'number' ? `${d.heightCm} cm` : '—'}
          </DetailRow>
          <DetailRow label="Complexion">{text('complexion')}</DetailRow>
          <DetailRow label="Religion">{text('religion')}</DetailRow>
          <DetailRow label="Caste">{text('caste')}</DetailRow>
          <DetailRow label="Mother tongue">{text('motherTongue')}</DetailRow>
          <DetailRow label="Qualification">{text('highestQualification')}</DetailRow>
          <DetailRow label="Occupation">
            {text('occupationStatus').replace(/_/g, ' ')}
          </DetailRow>
          <DetailRow label="Marital status">{text('maritalStatus').replace(/_/g, ' ')}</DetailRow>
          <DetailRow label="Father">{(bag('father').name as string) || '—'}</DetailRow>
          <DetailRow label="Mother">{(bag('mother').name as string) || '—'}</DetailRow>
        </DetailGrid>
        <Caption tone="faint">
          These are edited on the web app, where the full form is. Everything below is editable
          here.
        </Caption>
      </Card>

      <HoroscopeSection profileId={profileId} details={d} onSaved={refresh} />
      <PreferencesSection profileId={profileId} details={d} onSaved={refresh} />
    </Screen>
  );
}
