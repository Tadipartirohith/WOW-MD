import { Platform } from 'react-native';
import Constants from 'expo-constants';

import { DetailGrid, DetailRow } from '@/components/chrome';
import { Body, Caption, Card, PageSubtitle, Screen, SectionTitle } from '@/components/ui';

/**
 * About: what this app is, and which copy of it you are holding.
 *
 * The version and the build matter more here than anywhere else on the phone:
 * the first question anybody answering a support case asks is which build the
 * problem was seen on, and "the app" is not an answer. Everything shown is read
 * from the running app rather than typed into this file, so it cannot drift out
 * of step with a release.
 */
export default function About() {
  const expo = Constants.expoConfig;
  // The store-facing build number, which is a different thing from the version
  // and is what a crash report will carry.
  const build =
    Platform.OS === 'ios'
      ? (expo?.ios?.buildNumber ?? null)
      : (expo?.android?.versionCode?.toString() ?? null);

  return (
    <Screen>
      <PageSubtitle>
        World of Weddings — matchmaking, the vendors a wedding is made of, and the people who check
        that everybody here is who they say they are.
      </PageSubtitle>

      <Card>
        <SectionTitle>This app</SectionTitle>
        <DetailGrid>
          <DetailRow label="Name">{expo?.name ?? 'WOW'}</DetailRow>
          <DetailRow label="Version">{expo?.version ?? '—'}</DetailRow>
          {build ? <DetailRow label="Build">{build}</DetailRow> : null}
          <DetailRow label="Platform">
            {Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Web'}
          </DetailRow>
        </DetailGrid>
        <Caption tone="faint">
          Quote the version and build when you raise anything on Support. It is the difference
          between a bug somebody can find and one they cannot.
        </Caption>
      </Card>

      <Card>
        <SectionTitle>What it can do</SectionTitle>
        <Body tone="muted">
          What you see is decided by what your account is for. A vendor gets their listing, their
          bookings, their availability and their money; a verification officer gets the visits
          allocated to them and the cases they are investigating. Nothing is hidden to be
          mysterious — the server decides, and this app only ever shows what it would let you do.
        </Body>
      </Card>

      <Caption tone="faint">© {new Date().getFullYear()} World of Weddings</Caption>
    </Screen>
  );
}
