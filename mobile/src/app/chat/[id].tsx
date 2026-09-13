import { useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PaperPlaneRight } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Alert, Body, Caption, Loading } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * One conversation (EZ1-I261).
 *
 * Who may talk to whom is the server's rule — an accepted interest between the
 * two sides — and it is enforced on every read and every send, so this screen
 * does not repeat it. What it does is the part a phone does better than the
 * website: the thread stays at the bottom, the keyboard does not cover what is
 * being typed, and opening it marks what was unread as read.
 *
 * Polled rather than socketed. The web client has a socket; wiring one here
 * would mean a second transport to keep authenticated and reconnecting, and a
 * five-second poll on an open thread is indistinguishable at conversation
 * speed.
 */
interface Message {
  id: string;
  senderId: string;
  body: string;
  mediaUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export default function Thread() {
  const theme = useTheme();
  const qc = useQueryClient();
  const navigation = useNavigation();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const list = useRef<FlatList<Message>>(null);

  // The other person's name belongs in the bar, not drawn into the page: it is
  // where the back button and the swipe-back gesture already are.
  useEffect(() => {
    if (name) navigation.setOptions({ title: name });
  }, [name, navigation]);

  const { data, isPending } = useQuery({
    queryKey: ['chat-history', id],
    queryFn: async () =>
      (await api.get('/chat/messages', { params: { withUserId: id, page: 1, limit: 50 } })).data as {
        data: Message[];
      },
    enabled: Boolean(id),
    retry: false,
    refetchInterval: 5_000,
  });

  const markRead = useMutation({
    mutationFn: async () => api.put('/chat/messages/read', {}, { params: { withUserId: id } }),
    onSuccess: () => {
      for (const key of ['conversations', 'unread-count']) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  // Opening a thread is reading it. Once per arrival rather than per poll,
  // which would be a write every five seconds for a screen nobody touched.
  const marked = useRef(false);
  useEffect(() => {
    if (!id || marked.current || isPending) return;
    marked.current = true;
    markRead.mutate();
  }, [id, isPending, markRead]);

  const send = useMutation({
    mutationFn: async (body: string) =>
      (await api.post('/chat/messages', { toUserId: id, body })).data,
    onSuccess: () => {
      setDraft('');
      setError('');
      void qc.invalidateQueries({ queryKey: ['chat-history', id] });
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err) => setError(apiMessage(err, 'That message could not be sent.')),
  });

  // Newest first off the server, which is the order a thread is read in from
  // the bottom — so the list is inverted rather than reversed in memory.
  const messages = data?.data ?? [];

  if (isPending) {
    return (
      <View style={{ flex: 1, padding: space(4), backgroundColor: rgb(theme.canvas) }}>
        <Loading rows={4} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: rgb(theme.canvas) }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 92 : 0}
    >
      <FlatList
        ref={list}
        inverted
        data={messages}
        keyExtractor={(message) => message.id}
        contentContainerStyle={{ padding: space(4), gap: space(2) }}
        ListEmptyComponent={
          <Caption tone="faint" style={{ textAlign: 'center' }}>
            No messages yet. Say hello.
          </Caption>
        }
        renderItem={({ item }) => <Bubble message={item} mine={item.senderId !== id} />}
      />

      {error ? (
        <View style={{ paddingHorizontal: space(4) }}>
          <Alert tone="critical">{error}</Alert>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: space(2),
          padding: space(3),
          borderTopWidth: 1,
          borderTopColor: rgb(theme.border),
          backgroundColor: rgb(theme.surface),
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Write a message"
          placeholderTextColor={rgb(theme.ink[400])}
          multiline
          maxLength={2000}
          style={{
            flex: 1,
            maxHeight: 120,
            minHeight: 44,
            borderRadius: radius.md,
            paddingHorizontal: space(3),
            paddingTop: space(2.5),
            paddingBottom: space(2.5),
            backgroundColor: rgb(theme.surfaceSunken),
            color: rgb(theme.ink[900]),
            fontSize: 16,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          disabled={!draft.trim() || send.isPending}
          onPress={() => send.mutate(draft.trim())}
          style={({ pressed }) => [
            {
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: rgb(draft.trim() ? theme.brand : theme.surfaceSunken),
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          <PaperPlaneRight
            size={19}
            weight="fill"
            color={rgb(draft.trim() ? theme.brandFg : theme.ink[400])}
          />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/** One message. Mine on the right in the brand colour, theirs on the left. */
function Bubble({ message, mine }: { message: Message; mine: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View
        style={{
          maxWidth: '82%',
          borderRadius: radius.md,
          paddingHorizontal: space(3),
          paddingVertical: space(2),
          backgroundColor: rgb(mine ? theme.brand : theme.surface),
          borderWidth: mine ? 0 : 1,
          borderColor: rgb(theme.border),
        }}
      >
        <Body tone={mine ? 'onBrand' : 'default'}>{message.body}</Body>
      </View>
      <Caption tone="faint" style={{ marginTop: space(0.5) }}>
        {dateTime(message.createdAt)}
        {/* Whether they have read it, on your own messages only: the other
            side's reading of theirs is not yours to know. */}
        {mine ? (message.readAt ? ' · read' : ' · sent') : ''}
      </Caption>
    </View>
  );
}
