import { Linking, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { FileText, SealCheck } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { isChartImage } from '@/shared/horoscope';
import { formatDate } from '@/shared/dates';
import { DetailGrid, DetailRow } from '@/components/chrome';
import {
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Loading,
  PageSubtitle,
  PageTitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * One profile, as somebody browsing may see it (EZ1-I261, EZ1-I231).
 *
 * The web app's View Profile, on a phone. What is shown is the server's
 * decision and not this screen's: before a mutual accept it answers with the
 * basic card and the horoscope headline, and the family, the contact details
 * and the rest of the gallery arrive only once both sides have agreed. This
 * renders whichever of the two came back and says which it is.
 *
 * The chart is here because it is what families actually compare before
 * deciding whether to send interest at all — the same reasoning that put it on
 * the web card. A photograph of one is shown; a PDF is opened by the phone,
 * because drawing a PDF into an image is a broken-image icon and reads as an
 * upload that failed.
 */
interface ProfileView {
  limited: boolean;
  profile: {
    id: string;
    displayName: string;
    profileCode: string | null;
    city: string | null;
    gender: string | null;
    ageRange: string | null;
    photos: string[];
    identityVerified: boolean;
  };
  details: Record<string, unknown> | null;
  siblings: { name?: string | null; relation?: string | null }[];
  contact: { phone?: string | null; email?: string | null } | null;
}

export default function MatchProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isPending, error } = useQuery({
    queryKey: ['profile-view', id],
    queryFn: async () => (await api.get(`/profiles/${id}/view`)).data as ProfileView,
    enabled: Boolean(id),
    retry: false,
  });

  if (isPending) {
    return (
      <Screen>
        <Loading rows={4} />
      </Screen>
    );
  }

  if (error || !data) {
    return (
      <Screen>
        <EmptyState title="This profile is not available">
          {apiMessage(error, 'It may have been withdrawn, or it may not be yours to open.')}
        </EmptyState>
      </Screen>
    );
  }

  const { profile } = data;
  const d = (data.details ?? {}) as Record<string, unknown>;
  const text = (key: string): string | null => {
    const value = d[key];
    return typeof value === 'string' && value.trim() ? value : null;
  };
  const bag = (key: string): Record<string, unknown> =>
    (d[key] as Record<string, unknown> | undefined) ?? {};

  // Before the accept the chart facts are flattened onto the view; after it
  // they sit inside the horoscope block. Both are read, so one screen serves
  // the two shapes the server sends.
  const chart = { ...bag('horoscope'), ...d };
  const chartText = (key: string): string | null => {
    const value = chart[key];
    return typeof value === 'string' && value.trim() ? value : null;
  };
  const chartUrl = typeof d.horoscopeDocumentUrl === 'string' ? d.horoscopeDocumentUrl : null;

  return (
    <Screen>
      <View style={{ gap: space(1) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
          <PageTitle>{profile.displayName}</PageTitle>
          {profile.identityVerified ? <SealCheck size={20} weight="fill" color="#1f8a5b" /> : null}
        </View>
        <PageSubtitle>
          {[profile.ageRange, profile.city, profile.profileCode].filter(Boolean).join(' · ')}
        </PageSubtitle>
      </View>

      {profile.photos.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
          {profile.photos.map((photo) => (
            <Image
              key={photo}
              source={{ uri: photo }}
              style={{ width: 104, height: 130, borderRadius: radius.md }}
              contentFit="cover"
              transition={150}
            />
          ))}
        </View>
      ) : null}

      <Card>
        <SectionTitle>About</SectionTitle>
        <DetailGrid>
          <DetailRow label="Age">{profile.ageRange ?? '—'}</DetailRow>
          <DetailRow label="City">{profile.city ?? '—'}</DetailRow>
          <DetailRow label="Religion">{text('religion') ?? '—'}</DetailRow>
          <DetailRow label="Caste">{text('caste') ?? '—'}</DetailRow>
          <DetailRow label="Mother tongue">{text('motherTongue') ?? '—'}</DetailRow>
          <DetailRow label="Education">{text('highestQualification') ?? '—'}</DetailRow>
          <DetailRow label="Occupation">
            {text('occupationStatus')?.replace(/_/g, ' ') ?? '—'}
          </DetailRow>
          {typeof d.heightCm === 'number' ? (
            <DetailRow label="Height">{`${d.heightCm} cm`}</DetailRow>
          ) : null}
        </DetailGrid>
      </Card>

      <Card>
        <SectionTitle>Horoscope</SectionTitle>
        <DetailGrid>
          <DetailRow label="Rashi">{chartText('rashi') ?? '—'}</DetailRow>
          <DetailRow label="Star">{chartText('star') ?? '—'}</DetailRow>
          <DetailRow label="Padam">{chartText('padam') ?? '—'}</DetailRow>
          <DetailRow label="Gothram">{chartText('gothram') ?? '—'}</DetailRow>
          <DetailRow label="Kuja dosham">{chartText('kujaDosham') ?? '—'}</DetailRow>
        </DetailGrid>
        <HoroscopeChart url={chartUrl} />
      </Card>

      {data.limited ? (
        <Caption tone="faint">
          Family, contact details and the rest of the biodata are shared once you both accept
          interest.
        </Caption>
      ) : (
        <>
          <Card>
            <SectionTitle>Family</SectionTitle>
            <DetailGrid>
              <DetailRow label="Father">
                {(bag('father').name as string | undefined) || '—'}
              </DetailRow>
              <DetailRow label="Mother">
                {(bag('mother').name as string | undefined) || '—'}
              </DetailRow>
              <DetailRow label="Family type">{text('familyType') ?? '—'}</DetailRow>
            </DetailGrid>
            {data.siblings.length > 0 ? (
              <Caption tone="muted">
                Siblings: {data.siblings.map((s) => s.name).filter(Boolean).join(', ')}
              </Caption>
            ) : null}
          </Card>

          {data.contact ? (
            <Card>
              <SectionTitle>Contact</SectionTitle>
              <DetailGrid>
                <DetailRow label="Phone">{data.contact.phone ?? '—'}</DetailRow>
                <DetailRow label="Email">{data.contact.email ?? '—'}</DetailRow>
              </DetailGrid>
            </Card>
          ) : null}

          <Card>
            <SectionTitle>Marital status</SectionTitle>
            <DetailGrid>
              <DetailRow label="Status">
                {text('maritalStatus')?.replace(/_/g, ' ') ?? '—'}
              </DetailRow>
              {typeof bag('maritalHistory').marriageDate === 'string' ? (
                <DetailRow label="Married on">
                  {formatDate(bag('maritalHistory').marriageDate as string)}
                </DetailRow>
              ) : null}
            </DetailGrid>
          </Card>
        </>
      )}
    </Screen>
  );
}

/** The chart, drawn if it can be drawn and offered to the phone if not. */
function HoroscopeChart({ url }: { url: string | null }) {
  const theme = useTheme();

  if (!url) {
    /*
     * Not the same answer as a field somebody chose to withhold. This family
     * keeps a horoscope — that is why the section is here — and has not
     * attached the chart (EZ1-I231).
     */
    return <Caption tone="faint">Chart: not uploaded</Caption>;
  }

  if (isChartImage(url)) {
    return (
      <Image
        source={{ uri: url }}
        style={{
          width: '100%',
          height: 260,
          borderRadius: radius.sm,
          backgroundColor: rgb(theme.surfaceSunken),
        }}
        contentFit="contain"
        transition={150}
      />
    );
  }

  return (
    <View style={{ gap: space(1.5) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
        <FileText size={18} color={rgb(theme.ink[400])} />
        <Body tone="muted" style={{ flex: 1 }}>
          The chart is a document.
        </Body>
      </View>
      <Button label="Open the chart" variant="outline" small onPress={() => void Linking.openURL(url)} />
    </View>
  );
}
