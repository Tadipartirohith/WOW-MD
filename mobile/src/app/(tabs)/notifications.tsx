import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { formatDate } from '@/shared/dates';
import { TYPE_LABEL, describe, type Notification } from '@/shared/notification-copy';
import { Body, Caption, Card, EmptyState, Loading, PageSubtitle, PageTitle } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * Notifications.
 *
 * The wording is the web app's, imported rather than rewritten (see
 * src/shared/notification-copy). What is different here is the reading of an
 * item: tapping a row marks it read, because on a phone that is what tapping a
 * notification means, and a separate "mark as read" control beside every row
 * would be a column of buttons nobody presses.
 */
export default function Notifications() {
  const theme = useTheme();
  const qc = useQueryClient();

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
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => !item.isRead && markRead.mutate(item.id)}
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
          </Card>
        </Pressable>
      )}
    />
  );
}
