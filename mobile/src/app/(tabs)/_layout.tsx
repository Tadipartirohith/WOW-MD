import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { Bell, DotsThreeCircle, House, Sparkle, type IconProps } from 'phosphor-react-native';

import { Permission, can } from '@/shared/permissions';
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
 * with a tab that only ever answers 403 is worse than a shorter bar.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const permissions = useAuth((s) => s.user?.permissions ?? []);

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
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: icon(House) }}
      />
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
        name="notifications"
        options={{ title: 'Alerts', tabBarIcon: icon(Bell) }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: icon(DotsThreeCircle) }}
      />
    </Tabs>
  );
}
