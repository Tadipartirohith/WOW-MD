import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Bell,
  Briefcase,
  CalendarBlank,
  CaretRight,
  Check,
  ClipboardText,
  Coins,
  Receipt,
  SealCheck,
  type IconProps,
} from 'phosphor-react-native';

import { signOut } from '@/lib/api';
import { Permission, ROLE_LABEL, can, canAny } from '@/shared/permissions';
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
import { useAuth } from '@/store/auth';
import { radius, rgb, space, useTheme, useThemeChoice, type ThemeChoice } from '@/theme';

/**
 * More: everything the tab bar could not hold, plus the account itself.
 *
 * The bar fits five, and a vendor's portal is six screens; an officer's is
 * four. So this is the rest of the sidebar, grouped under the same headings the
 * web app groups them under — "Your business", "Operations" — because a vendor
 * who has used the site is looking for a heading they already know.
 *
 * Only what exists is listed. The earlier version of this screen deliberately
 * carried no directory at all, on the grounds that a menu of links to screens
 * that do not exist is a menu of dead ends; that argument still holds, so the
 * screens that are still web-only are named as such at the bottom rather than
 * offered as rows that go nowhere.
 */
export default function More() {
  const user = useAuth((s) => s.user);
  const permissions = user?.permissions ?? [];

  const isVendor = can(permissions, Permission.VENDOR_LISTING_MANAGE);
  const isProvider = canAny(permissions, [
    Permission.VENDOR_LISTING_MANAGE,
    Permission.PLANNER_LISTING_MANAGE,
  ]);
  const isOfficer = canAny(permissions, [
    Permission.VERIFICATION_PROCESS,
    Permission.VERIFICATION_ALLOCATE,
  ]);

  return (
    <Screen>
      <View style={{ gap: space(1), marginTop: space(4) }}>
        <PageTitle>More</PageTitle>
        <PageSubtitle>{user?.email ?? 'Signed in'}</PageSubtitle>
      </View>

      <Card>
        <Eyebrow>Signed in as</Eyebrow>
        <SectionTitle>{user ? (ROLE_LABEL[user.role] ?? user.role) : 'Unknown'}</SectionTitle>
        {/* This is the email-confirmation flag, not in-person identity — which
            no longer gates matchmaking for individuals. */}
        {user?.isVerified ? (
          <Caption>Your email address is confirmed.</Caption>
        ) : (
          <Caption>Confirm your email address to secure your account.</Caption>
        )}
      </Card>

      {/* Your business — the same heading, in the same order, as the sidebar. */}
      {isProvider && (
        <Group title="Your business">
          {isVendor ? (
            <Row icon={Briefcase} label="My Business" hint="Your listing, services and prices" to="/business" />
          ) : null}
          <Row
            icon={Receipt}
            label="Bookings"
            hint="Requests, quotations and the work in flight"
            to="/bookings"
          />
          <Row
            icon={CalendarBlank}
            label="Availability"
            hint="The windows you can take work in"
            to="/availability"
          />
          <Row icon={Coins} label="Accounts" hint="Escrow, payouts and the ledger" to="/accounts" />
        </Group>
      )}

      {isOfficer && (
        <Group title="Operations">
          <Row
            icon={SealCheck}
            label="Verification"
            hint="Visits allocated to you, and your availability"
            to="/verification"
          />
          {can(permissions, Permission.CASE_INVESTIGATE) ? (
            <Row
              icon={ClipboardText}
              label="Cases"
              hint="Investigations, evidence and resolutions"
              to="/cases"
            />
          ) : null}
        </Group>
      )}

      <Group title="Account">
        <Row icon={Bell} label="Notifications" hint="Everything the platform has told you" to="/notifications" />
      </Group>

      <Appearance />

      {/*
        Said out loud rather than left to be discovered. A provider who cannot
        find My Reviews should know it is on the site and not that the app has
        lost it.
      */}
      {isProvider ? (
        <Caption tone="faint">
          My Reviews, Support and Security are on the web app for now.
        </Caption>
      ) : null}

      <Button label="Sign out" variant="outline" onPress={() => void signOut()} />
    </Screen>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space(1.5) }}>
      <Eyebrow>{title}</Eyebrow>
      <Card style={{ padding: 0, gap: 0, overflow: 'hidden' }}>{children}</Card>
    </View>
  );
}

function Row({
  icon: Glyph,
  label,
  hint,
  to,
}: {
  icon: React.ComponentType<IconProps>;
  label: string;
  hint: string;
  to: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      // Cast because these paths are generated into the router's type union at
      // build time, and this list is written once for every persona.
      onPress={() => router.push(to as never)}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space(3),
          paddingHorizontal: space(4),
          paddingVertical: space(3),
          minHeight: 60,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: rgb(theme.border),
        },
        pressed && { backgroundColor: rgb(theme.surfaceSunken) },
      ]}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: rgb(theme.brandSoft),
        }}
      >
        <Glyph size={17} color={rgb(theme.brandStrong)} />
      </View>
      <View style={{ flex: 1, gap: space(0.5) }}>
        <Body>{label}</Body>
        <Caption tone="faint" numberOfLines={1}>
          {hint}
        </Caption>
      </View>
      <CaretRight size={16} color={rgb(theme.ink[400])} />
    </Pressable>
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
