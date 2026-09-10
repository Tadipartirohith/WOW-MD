import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import {
  Bell,
  Briefcase,
  CalendarBlank,
  ClipboardText,
  DotsThreeCircle,
  House,
  Receipt,
  SealCheck,
  Sparkle,
  type IconProps,
} from 'phosphor-react-native';

import { Permission, can, canAny } from '@/shared/permissions';
import { useAuth } from '@/store/auth';
import { rgb, useTheme } from '@/theme';

/**
 * The tab bar.
 *
 * The web app has twenty-five navigation entries in seven groups, which works
 * on a rail and cannot work along the bottom of a phone. So the bar carries
 * only what a person opens repeatedly, and everything else lives behind More,
 * grouped exactly as the sidebar groups it.
 *
 * Which tabs exist is decided by capability, the same way the sidebar decides:
 * a vendor has no Matches tab because a vendor cannot browse matches, and a bar
 * with a tab that only ever answers 403 is worse than a shorter bar. That gives
 * each persona its own five:
 *
 *   individual/agent   Home · Matches · Alerts · More
 *   vendor / planner   Home · Business · Bookings · Availability · More
 *   officer            Home · Verification · Cases · Alerts · More
 *
 * A provider's Alerts moves behind More rather than taking a fifth slot from
 * the three screens they actually work in — and notifications reach them by
 * push anyway. The web app agrees about the priority: Notifications sits under
 * "Account" there, below "Your business".
 */
export default function TabsLayout() {
  const theme = useTheme();
  const permissions = useAuth((s) => s.user?.permissions ?? []);

  // A seller: a vendor or a wedding planner. Both take bookings against
  // published windows, and both manage a listing.
  const isProvider = canAny(permissions, [
    Permission.VENDOR_LISTING_MANAGE,
    Permission.PLANNER_LISTING_MANAGE,
  ]);
  // My Business as a tab is the vendor's guided set-up; a planner's listing is
  // one form and lives behind More, as it does on the web.
  const isVendor = can(permissions, Permission.VENDOR_LISTING_MANAGE);
  // The same pair the web sidebar gates Verification on.
  const isOfficer = canAny(permissions, [
    Permission.VERIFICATION_PROCESS,
    Permission.VERIFICATION_ALLOCATE,
  ]);
  // Cases, on the same capability the web sidebar uses. An administrator works
  // them from Support there, which this app does not carry, so the tab is not
  // withheld from them here — it is the same records either way.
  const worksCases = can(permissions, Permission.CASE_INVESTIGATE);

  // The colour is read from the tokens rather than taken from the tab bar's
  // own `color` argument, which is a ColorValue and not always a string.
  const icon =
    (Icon: React.ComponentType<IconProps>) =>
    ({ focused }: { focused: boolean }) => (
      // Filled when active, the same signal the sidebar uses. Weight carries
      // the state on its own, so the label is not doing the work twice.
      <Icon
        size={24}
        color={rgb(focused ? theme.brandStrong : theme.ink[400])}
        weight={focused ? 'fill' : 'regular'}
      />
    );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: rgb(theme.brandStrong),
        tabBarInactiveTintColor: rgb(theme.ink[400]),
        tabBarStyle: {
          backgroundColor: rgb(theme.surface),
          borderTopColor: rgb(theme.border),
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        sceneStyle: { backgroundColor: rgb(theme.canvas) },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon(House) }} />
      <Tabs.Screen
        name="matches"
        options={{
          title: 'Matches',
          tabBarIcon: icon(Sparkle),
          // `href: null` is how a tab is withheld rather than disabled: the
          // route still exists for a deep link, it simply has no button.
          href: can(permissions, Permission.MATCH_BROWSE) ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="business"
        options={{
          title: 'Business',
          tabBarIcon: icon(Briefcase),
          href: isVendor ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: 'Bookings',
          tabBarIcon: icon(Receipt),
          // The seller's queue. A buyer's own bookings are a different screen
          // and are not part of this app yet.
          href: can(permissions, Permission.BOOKING_READ_INCOMING) ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="availability"
        options={{
          title: 'Availability',
          tabBarIcon: icon(CalendarBlank),
          href: isProvider ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="verification"
        options={{
          title: 'Verification',
          tabBarIcon: icon(SealCheck),
          href: isOfficer ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="cases"
        options={{
          title: 'Cases',
          tabBarIcon: icon(ClipboardText),
          href: worksCases ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Alerts',
          tabBarIcon: icon(Bell),
          href: isProvider ? null : undefined,
        }}
      />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon(DotsThreeCircle) }} />
    </Tabs>
  );
}
