import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'phosphor-react-native';

import { api } from '@/lib/api';
import { Caption } from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

/**
 * The way into Notifications for somebody whose tab bar has no Alerts tab.
 *
 * A provider's five tabs are the five screens they work in, and Alerts is not
 * one of them — but it was then only reachable from More, two taps and a
 * heading away, with no count anywhere to say it was worth the trip
 * (EZ1-I255). So the count comes to Home instead, where a vendor already looks
 * first.
 *
 * Polled on the same interval as the rest of the dashboard, and sharing its
 * query key with the counter on Home, so the badge and the number underneath it
 * cannot disagree.
 */
export function NotificationBell() {
  const theme = useTheme();
  const router = useRouter();

  const { data } = useQuery({
    queryKey: ['unread-count'],
    queryFn: async () => (await api.get('/notifications/unread-count')).data as { unread: number },
    retry: false,
    refetchInterval: 30_000,
    refetchOnMount: 'always',
  });

  const unread = data?.unread ?? 0;
  // Past ninety-nine the exact figure stops being information and starts being
  // a wide badge.
  const badge = unread > 99 ? '99+' : String(unread);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        unread > 0 ? `Notifications, ${unread} unread` : 'Notifications, none unread'
      }
      onPress={() => router.push('/notifications')}
      hitSlop={8}
      style={({ pressed }) => [
        {
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: rgb(theme.surface),
          borderWidth: 1,
          borderColor: rgb(theme.border),
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Bell size={20} color={rgb(theme.ink[700])} weight={unread > 0 ? 'fill' : 'regular'} />
      {unread > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            paddingHorizontal: space(0.75),
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: rgb(theme.criticalFg),
          }}
        >
          <Caption
            tone="onBrand"
            style={{ fontSize: 10, lineHeight: 14, fontWeight: '700' }}
          >
            {badge}
          </Caption>
        </View>
      ) : null}
    </Pressable>
  );
}
