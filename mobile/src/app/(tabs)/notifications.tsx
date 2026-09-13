import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CaretRight } from 'phosphor-react-native';

import { api } from '@/lib/api';
import { routeFor } from '@/lib/notification-route';
import { formatDate } from '@/shared/dates';
import { ACTION_LABEL, TYPE_LABEL, describe, type Notification } from '@/shared/notification-copy';
import { Permission, can, canAny } from '@/shared/permissions';
import { Body, Caption, Card, EmptyState, Loading, PageSubtitle, PageTitle } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * Notifications.
 *
 * The wording is the web app's, imported rather than rewritten (see
 * src/shared/notification-copy). What is different here is the reading of an
 * item: tapping a row marks it read, because on a phone that is what tapping a
 * notification means, and a separate "mark as read" control beside every row
 * would be a column of buttons nobody presses.
 *
 * Tapping also opens the thing the notification is about — the booking, the
 * visit, the case — and which thing that is comes from the server, which writes
 * a target module, action and id on every row (EZ1-I254). A row this app has no
 * screen for still reads and still marks itself read; it simply does not
 * pretend to lead anywhere, because opening the wrong screen is worse than
 * opening none.
 */
export default function Notifications() {
  const theme = useTheme();
  const qc = useQueryClient();
  const router = useRouter();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  // Only a seller has the bookings queue a booking notification opens.
  const canReadIncoming = can(permissions, Permission.BOOKING_READ_INCOMING);
  // Staff read a case on the Cases queue; everybody else reads their own on
  // Support. The same split the web app makes.
  const canVerify = canAny(permissions, [
    Permission.VERIFICATION_PROCESS,
    Permission.VERIFICATION_ALLOCATE,
  ]);

  const { data, isPending, refetch, isRefetching } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/notifications')).data as Notification[],
    retry: false,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.put(`/notifications/${id}/read`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });

  const markAll = useMutation({
    mutationFn: () => api.put('/notifications/read-all', {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
      void qc.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });

  const items = data ?? [];
  const unread = items.filter((n) => !n.isRead).length;

  const header = (
    <View style={{ gap: space(1), marginTop: space(4), marginBottom: space(2) }}>
      <PageTitle>Notifications</PageTitle>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <PageSubtitle>
          {unread > 0 ? `${unread} waiting on you.` : 'Everything here has been read.'}
        </PageSubtitle>
        {unread > 0 ? (
          <Pressable onPress={() => markAll.mutate()} hitSlop={8} accessibilityRole="button">
            <Caption tone="brand">Mark all read</Caption>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  if (isPending) {
    return (
      <View style={{ flex: 1, padding: space(4), gap: space(4) }}>
        {header}
        <Loading rows={4} />
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(n) => n.id}
      contentContainerStyle={{ padding: space(4), gap: space(2), paddingBottom: space(12) }}
      ListHeaderComponent={header}
      refreshControl={
        // Pull to refresh, because a notification list is the one screen people
        // pull on by reflex.
        <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={rgb(theme.ink[400])} />
      }
      ListEmptyComponent={
        <EmptyState title="Nothing to catch up on">
          Interests, bookings and verification decisions all land here.
        </EmptyState>
      }
      renderItem={({ item }) => {
        const route = routeFor(item, { canVerify, canReadIncoming });
        return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${TYPE_LABEL[item.type] ?? 'Update'}. ${describe(item)}`}
          onPress={() => {
            // Read first, then open: a row that navigates before it marks
            // itself read comes back unread when the person returns.
            if (!item.isRead) markRead.mutate(item.id);
            if (route) router.push(route);
          }}
          style={({ pressed }) => [pressed && { opacity: 0.7 }]}
        >
          <Card style={{ gap: space(1.5) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
              {/*
                A dot rather than bold text for the unread state. Bolding the
                whole row makes a list of unread items look like a list of
                headings, and the moment two are read the column goes ragged.
              */}
              {!item.isRead ? (
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: radius.sm,
                    backgroundColor: rgb(theme.brand),
                  }}
                />
              ) : null}
              <Caption tone={item.isRead ? 'faint' : 'brand'} style={{ flex: 1 }} numberOfLines={1}>
                {TYPE_LABEL[item.type] ?? 'Update'}
              </Caption>
              <Caption tone="faint">{formatDate(item.createdAt)}</Caption>
            </View>
            <Body tone={item.isRead ? 'muted' : 'default'}>
              {describe(item) || 'Something has changed on your account.'}
            </Body>
            {/* What pressing this does, said rather than implied — and nothing
                at all on a row that has nowhere to go. */}
            {route ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1) }}>
                <Caption tone="brand">
                  {(item.targetAction && ACTION_LABEL[item.targetAction]) ?? 'Open'}
                </Caption>
                <CaretRight size={12} color={rgb(theme.brandStrong)} />
              </View>
            ) : null}
          </Card>
        </Pressable>
        );
      }}
    />
  );
}
