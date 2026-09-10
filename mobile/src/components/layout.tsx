import type { ReactElement, ReactNode } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, Loading } from '@/components/ui';
import { rgb, space, useTheme } from '@/theme';

/**
 * A screen whose body is a list.
 *
 * The queues in these portals — bookings, visits, cases, availability windows —
 * are the screens a provider or an officer spends their day in, and the web
 * client renders each of them as one `<ul>` of every row it has. That is fine
 * for a browser and wrong here: a `ScrollView` mounts every child at once, so a
 * vendor with sixty bookings pays for sixty cards of images and nested queries
 * before the first one is on screen.
 *
 * So the list is a `FlatList`, which mounts what is visible and recycles the
 * rest. Everything above it — the title, the figures, the filters — is the list
 * header rather than a sibling above it, because two scrolling regions on one
 * screen is the layout where the inner one eats the gesture and neither moves.
 */
export function ListScreen<T>({
  header,
  data,
  renderItem,
  keyExtractor,
  loading = false,
  emptyTitle,
  emptyBody,
  onRefresh,
  refreshing = false,
  footer,
}: {
  header?: ReactNode;
  data: T[];
  renderItem: (item: T) => ReactElement;
  keyExtractor: (item: T) => string;
  loading?: boolean;
  emptyTitle: string;
  emptyBody?: string;
  /** Pull to refresh, which on a phone is the expected way to ask again. */
  onRefresh?: () => void;
  refreshing?: boolean;
  footer?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: rgb(theme.canvas) }}
      contentContainerStyle={{
        padding: space(4),
        // Clears the tab bar's own inset; without it the last row sits under
        // the bar and the list looks truncated.
        paddingBottom: insets.bottom + space(6),
        gap: space(2.5),
      }}
      data={data}
      keyExtractor={keyExtractor}
      renderItem={({ item }) => renderItem(item)}
      ListHeaderComponent={
        header ? <View style={{ gap: space(3.5), marginBottom: space(1) }}>{header}</View> : null
      }
      ListEmptyComponent={
        loading ? (
          <Loading rows={3} />
        ) : (
          <EmptyState title={emptyTitle}>{emptyBody}</EmptyState>
        )
      }
      ListFooterComponent={footer ? <View style={{ marginTop: space(2) }}>{footer}</View> : null}
      keyboardShouldPersistTaps="handled"
      // The rows carry nested queries and images, so keeping the window tight
      // is what makes a long queue scroll at frame rate.
      initialNumToRender={8}
      windowSize={7}
      removeClippedSubviews
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={rgb(theme.brandStrong)}
            colors={[rgb(theme.brandStrong)]}
          />
        ) : undefined
      }
    />
  );
}
