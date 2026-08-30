import { Pressable, StyleSheet, View } from 'react-native';
import { Check } from 'phosphor-react-native';

import { signOut } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { ROLE_LABEL } from '@/shared/permissions';
import {
  Body,
  Button,
  Caption,
  Card,
  Eyebrow,
  PageSubtitle,
  PageTitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { radius, rgb, space, useTheme, useThemeChoice, type ThemeChoice } from '@/theme';

/**
 * More: the account itself, and the settings that belong to this device.
 *
 * Deliberately not a directory of everything the web app can do. A menu of
 * links to screens that do not exist yet is a menu of dead ends, and it reads
 * as an unfinished app rather than a smaller one.
 */
export default function More() {
  const user = useAuth((s) => s.user);

  return (
    <Screen>
      <View style={{ gap: space(1), marginTop: space(4) }}>
        <PageTitle>Account</PageTitle>
        <PageSubtitle>{user?.email ?? 'Signed in'}</PageSubtitle>
      </View>

      <Card>
        <Eyebrow>Signed in as</Eyebrow>
        <SectionTitle>{user ? (ROLE_LABEL[user.role] ?? user.role) : 'Unknown'}</SectionTitle>
        {user?.isVerified ? (
          <Caption>Your identity has been verified.</Caption>
        ) : (
          <Caption>Identity not verified yet. Some actions stay closed until it is.</Caption>
        )}
      </Card>

      <Appearance />

      <Button label="Sign out" variant="outline" onPress={() => void signOut()} />
    </Screen>
  );
}

const CHOICES: { key: ThemeChoice; label: string; hint: string }[] = [
  { key: 'system', label: 'Match device', hint: 'Follows your phone, including at dusk.' },
  { key: 'light', label: 'Light', hint: 'Always light, whatever the phone is set to.' },
  { key: 'dark', label: 'Dark', hint: 'Always dark, whatever the phone is set to.' },
];

/**
 * Three states, not a switch.
 *
 * A two-position toggle cannot express "follow the phone", so the first time
 * the OS flips at dusk the app either disagrees with everything else on the
 * device or silently overrides a choice the person made. The web app carries
 * the same three.
 */
function Appearance() {
  const theme = useTheme();
  const choice = useThemeChoice((s) => s.choice);
  const set = useThemeChoice((s) => s.set);

  return (
    <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
      <View style={{ padding: space(4), paddingBottom: space(2) }}>
        <SectionTitle>Appearance</SectionTitle>
      </View>
      <View accessibilityRole="radiogroup">
        {CHOICES.map((option, i) => {
          const active = choice === option.key;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => set(option.key)}
              style={({ pressed }) => [
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space(3),
                  paddingHorizontal: space(4),
                  paddingVertical: space(3),
                  // A divided list rather than gaps: these are one set of
                  // mutually exclusive options, and space between them would
                  // read as three unrelated rows.
                  borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: rgb(theme.border),
                },
                pressed && { backgroundColor: rgb(theme.surfaceSunken) },
              ]}
            >
              <View style={{ flex: 1, gap: space(0.5) }}>
                <Body>{option.label}</Body>
                <Caption tone="faint">{option.hint}</Caption>
              </View>
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: radius.sm,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? rgb(theme.brand) : 'transparent',
                  borderWidth: active ? 0 : StyleSheet.hairlineWidth,
                  borderColor: rgb(theme.borderStrong),
                }}
              >
                {active ? <Check size={13} weight="bold" color={rgb(theme.brandFg)} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}
