import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  CaretRight,
  ChatCircleDots,
  Check,
  Coins,
  Gear,
  IdentificationCard,
  Info,
  Lifebuoy,
  Lock,
  SignOut,
  Star,
  UserCircle,
  type IconProps,
} from 'phosphor-react-native';

import { signOut } from '@/lib/api';
import { Permission, ROLE_LABEL, can, canAny } from '@/shared/permissions';
import {
  Body,
  Caption,
  Card,
  Eyebrow,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useAuth } from '@/store/auth';
import { radius, rgb, space, useTheme, useThemeChoice, type ThemeChoice } from '@/theme';

/**
 * More: the account, and nothing the tab bar already holds.
 *
 * What is one tap away along the bottom of the same phone is deliberately not
 * repeated here. An officer reaches Verification, Cases and Alerts from the bar;
 * a vendor reaches My Business, Bookings and Availability from the bar. Listing
 * them again meant two routes to the same screen and a menu that read as a
 * sitemap rather than an account page (EZ1-I257, EZ1-I255).
 *
 * So this is the account itself — who is signed in, their own profile, what
 * customers said, the way in when something breaks, the password and the
 * devices holding a session, the money — then how the app looks, and the way
 * out. Three groups, the same three for every persona, with the rows a persona
 * has no use for left out rather than shown dead.
 *
 * Notifications were here too. A vendor has no Alerts tab, so they now reach
 * them from the bell on Home, where the count is; every other persona has the
 * tab and was being offered the same screen twice.
 */
export default function More() {
  const user = useAuth((s) => s.user);
  const permissions = user?.permissions ?? [];

  const isVendor = can(permissions, Permission.VENDOR_LISTING_MANAGE);
  const isProvider = canAny(permissions, [
    Permission.VENDOR_LISTING_MANAGE,
    Permission.PLANNER_LISTING_MANAGE,
  ]);

  return (
    <Screen>
      <AccountHeader />

      {/* Matchmaking's other screens, for the personas that have them. Chat is
          here rather than in the bar because a conversation is opened from the
          person it is with — a match, an interest — far more often than from a
          list of all of them (EZ1-I261). */}
      {canAny(permissions, [Permission.PROFILE_MANAGE_OWN, Permission.CHAT_MATCH]) &&
      canAny(permissions, [Permission.MATCH_BROWSE, Permission.CHAT_MATCH]) ? (
        <Group title="Matchmaking">
          <Row
            icon={IdentificationCard}
            label="Biodata"
            hint="What families read before they ask about you"
            to="/biodata"
          />
          {canAny(permissions, [Permission.CHAT_MATCH]) ? (
            <Row
              icon={ChatCircleDots}
              label="Chat"
              hint="Conversations with families you have matched with"
              to="/chat"
            />
          ) : null}
        </Group>
      ) : null}

      <Group title="My account">
        <Row
          icon={UserCircle}
          label="My Profile"
          hint="Your name, contact details and what we hold"
          to="/profile"
        />
        {isVendor ? (
          <Row
            icon={Star}
            label="My Reviews"
            hint="What customers said after a completed booking"
            to="/my-reviews"
          />
        ) : null}
        <Row
          icon={Lifebuoy}
          label="Support"
          hint="Raise something that has gone wrong"
          to="/support"
        />
        <Row
          icon={Lock}
          label="Security"
          hint="Password, two-factor and signed-in devices"
          to="/security"
        />
        {isProvider ? (
          <Row icon={Coins} label="Accounts" hint="Escrow, payouts and the ledger" to="/accounts" />
        ) : null}
      </Group>

      <Group title="App settings">
        <Appearance />
      </Group>

      <Group title="Other">
        <Row icon={Info} label="About" hint="Version, build and what this app is" to="/about" />
        <Row
          icon={SignOut}
          label="Sign out"
          hint="End this session on this device"
          onPress={() => void signOut()}
        />
      </Group>
    </Screen>
  );
}

/**
 * Who is signed in, said once.
 *
 * The page used to open with its own name and the email underneath it, which
 * spent the top of the screen telling somebody the word they had just tapped.
 * The email and the role are the two facts that belong here — a vendor with a
 * second account needs to know which one this is before they act on anything
 * below — and the gear goes where a gear goes.
 */
function AccountHeader() {
  const theme = useTheme();
  const router = useRouter();
  const user = useAuth((s) => s.user);

  return (
    <Card style={{ marginTop: space(4) }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
        <View style={{ flex: 1, gap: space(0.5) }}>
          <Eyebrow>Signed in as</Eyebrow>
          <SectionTitle numberOfLines={1}>{user?.email ?? 'Signed in'}</SectionTitle>
          <Caption tone="faint">
            {user ? (ROLE_LABEL[user.role] ?? user.role) : 'Unknown'}
          </Caption>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Security settings"
          onPress={() => router.push('/security')}
          hitSlop={8}
          style={({ pressed }) => [
            {
              width: 38,
              height: 38,
              borderRadius: 19,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: rgb(theme.surfaceSunken),
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Gear size={19} color={rgb(theme.ink[600])} />
        </Pressable>
      </View>
      {/* This is the email-confirmation flag, not in-person identity — which
          no longer gates matchmaking for individuals. */}
      {user?.isVerified ? (
        <Caption>Your email address is confirmed.</Caption>
      ) : (
        <Caption>Confirm your email address to secure your account.</Caption>
      )}
    </Card>
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
  onPress,
}: {
  icon: React.ComponentType<IconProps>;
  label: string;
  hint: string;
  /** Where the row goes. Omitted for a row that does something instead. */
  to?: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      // Cast because these paths are generated into the router's type union at
      // build time, and this list is written once for every persona.
      onPress={() => (onPress ? onPress() : to ? router.push(to as never) : undefined)}
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

  // No card of its own: the group around it already is one, and a card inside a
  // card reads as two lists that happen to be touching.
  return (
    <>
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
    </>
  );
}
