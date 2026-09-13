import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';

import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Badge } from '@/components/chrome';
import { ListScreen } from '@/components/layout';
import { Body, Caption, Card, PageSubtitle, PageTitle } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * Every conversation, newest first (EZ1-I261).
 *
 * Only threads that exist: a conversation opens when both sides accept an
 * interest, which is the rule the server enforces and this screen does not
 * repeat. A booking's thread is deliberately not here — it lives on the
 * booking, where its rules are, and the server leaves it out.
 *
 * Two people called Pardhu in one list is not a hypothetical, it was the
 * reported problem, so each row carries what actually tells them apart: the
 * age and the town, and the profile code underneath.
 */
interface Conversation {
  conversationId: string;
  withUserId: string;
  displayName: string;
  photoUrl: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastMessageMine: boolean;
  unread: number;
  online: boolean;
  muted: boolean;
  context?: { standing: 'accepted' | 'fixed' } | null;
  facts?: { ageRange?: string | null; city?: string | null; profileCode?: string | null } | null;
}

export default function Conversations() {
  const theme = useTheme();
  const router = useRouter();

  const { data, isPending, isFetching, refetch } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => (await api.get('/chat/conversations')).data as Conversation[],
    retry: false,
    // A conversation list nobody is looking at is a conversation list that is
    // wrong by the time they are.
    refetchInterval: 20_000,
  });

  return (
    <ListScreen
      header={
        <View style={{ gap: space(1) }}>
          <PageTitle>Chat</PageTitle>
          <PageSubtitle>
            Conversations open once both families have accepted an interest.
          </PageSubtitle>
        </View>
      }
      data={data ?? []}
      keyExtractor={(row) => row.conversationId}
      loading={isPending}
      refreshing={isFetching && !isPending}
      onRefresh={() => void refetch()}
      emptyTitle="No conversations yet"
      emptyBody="Accept an interest, or have one accepted, and the thread opens here."
      renderItem={(row) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open the conversation with ${row.displayName}`}
          onPress={() =>
            router.push({
              pathname: '/chat/[id]',
              params: { id: row.withUserId, name: row.displayName },
            })
          }
          style={({ pressed }) => [pressed && { opacity: 0.7 }]}
        >
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3) }}>
            {row.photoUrl ? (
              <Image
                source={{ uri: row.photoUrl }}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 23,
                  backgroundColor: rgb(theme.surfaceSunken),
                }}
                contentFit="cover"
              />
            ) : (
              <View
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 23,
                  backgroundColor: rgb(theme.surfaceSunken),
                }}
              />
            )}

            <View style={{ flex: 1, gap: space(0.5) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
                <Body style={{ flexShrink: 1, fontWeight: '600' }} numberOfLines={1}>
                  {row.displayName}
                </Body>
                {row.online ? (
                  <View
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: radius.sm,
                      backgroundColor: rgb(theme.positiveFg),
                    }}
                  />
                ) : null}
                {row.context?.standing === 'fixed' ? <Badge tone="positive">Match fixed</Badge> : null}
                {row.muted ? <Badge>Muted</Badge> : null}
              </View>

              <Caption tone="faint" numberOfLines={1}>
                {[row.facts?.ageRange, row.facts?.city, row.facts?.profileCode]
                  .filter(Boolean)
                  .join(' · ')}
              </Caption>

              <Caption tone={row.unread > 0 ? 'default' : 'faint'} numberOfLines={1}>
                {row.lastMessage
                  ? `${row.lastMessageMine ? 'You: ' : ''}${row.lastMessage}`
                  : 'No messages yet'}
              </Caption>
            </View>

            <View style={{ alignItems: 'flex-end', gap: space(1) }}>
              <Caption tone="faint">{row.lastMessageAt ? dateTime(row.lastMessageAt) : ''}</Caption>
              {row.unread > 0 ? <Badge tone="brand">{String(row.unread)}</Badge> : null}
            </View>
          </View>
        </Card>
        </Pressable>
      )}
    />
  );
}
