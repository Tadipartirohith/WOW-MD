import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PaperPlaneRight } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Alert, Body, Button, Caption } from '@/components/ui';
import { useAuth } from '@/store/auth';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * The conversation about one job.
 *
 * Deliberately not a chat screen with a booking picker — the same decision the
 * web client makes, and for the same reason: everything said here is about this
 * booking, which is what lets the rules exist at all. It opens when the advance
 * is held and stops taking messages when the job is finished, still readable,
 * because what was agreed in it is what a dispute turns on.
 *
 * The server decides both and says why in a sentence rendered verbatim.
 * Re-deriving "can I type?" from the booking status here would be a second copy
 * of the rule, and the two would disagree the first time one changed.
 */
export function BookingChat({ bookingId }: { bookingId: string }) {
  const theme = useTheme();
  const qc = useQueryClient();
  const me = useAuth((s) => s.user?.id);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const { data: state } = useQuery({
    queryKey: ['booking-chat-state', bookingId],
    queryFn: async () =>
      (await api.get(`/bookings/${bookingId}/chat`)).data as {
        canSend: boolean;
        open: boolean;
        note: string;
      },
    retry: false,
  });

  const { data: thread } = useQuery({
    queryKey: ['booking-chat', bookingId],
    queryFn: async () =>
      (await api.get(`/bookings/${bookingId}/messages`, { params: { limit: 50 } })).data as {
        data: { id: string; senderId: string; body: string; createdAt: string }[];
      },
    // Only once the provider has actually opened it: a queue of forty bookings
    // must not poll forty threads nobody is reading.
    enabled: open && Boolean(state?.open),
    // The other side is typing on their own schedule, so this polls rather
    // than waiting for a reason to refetch.
    refetchInterval: 15_000,
    retry: false,
  });

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setError('');
    setSending(true);
    try {
      await api.post(`/bookings/${bookingId}/messages`, { body });
      setDraft('');
      void qc.invalidateQueries({ queryKey: ['booking-chat', bookingId] });
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setSending(false);
    }
  }

  if (!state) return null;

  if (!open) {
    return (
      <Button
        label="Message the client"
        variant="ghost"
        small
        onPress={() => setOpen(true)}
      />
    );
  }

  const messages = thread?.data ?? [];

  return (
    <View style={{ gap: space(2), width: '100%' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
        <Body style={{ flex: 1, fontWeight: '600' }}>Messages</Body>
        <Button label="Hide" variant="ghost" small onPress={() => setOpen(false)} />
      </View>

      {/* The server's own sentence about why this thread is or is not open. */}
      {state.note ? <Caption tone="faint">{state.note}</Caption> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}

      {state.open && (
        <ScrollView
          style={{
            maxHeight: 260,
            backgroundColor: rgb(theme.surfaceSunken),
            borderRadius: radius.sm,
          }}
          contentContainerStyle={{ padding: space(2.5), gap: space(2) }}
        >
          {messages.length === 0 ? (
            <Caption tone="faint">Nothing said yet.</Caption>
          ) : (
            messages.map((message) => {
              const mine = message.senderId === me;
              return (
                <View
                  key={message.id}
                  style={{
                    alignSelf: mine ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    backgroundColor: rgb(mine ? theme.brandSoft : theme.surface),
                    borderRadius: radius.sm,
                    paddingHorizontal: space(2.5),
                    paddingVertical: space(2),
                    gap: space(0.5),
                  }}
                >
                  <Body>{message.body}</Body>
                  <Caption tone="faint">{dateTime(message.createdAt)}</Caption>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {state.canSend && (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space(2) }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a message"
            placeholderTextColor={rgb(theme.ink[400])}
            multiline
            style={{
              flex: 1,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: rgb(theme.border),
              backgroundColor: rgb(theme.surface),
              borderRadius: radius.sm,
              paddingHorizontal: space(3),
              paddingTop: space(2.5),
              paddingBottom: space(2.5),
              fontSize: 16,
              color: rgb(theme.ink[900]),
              minHeight: 46,
              maxHeight: 120,
            }}
          />
          {/* Icon-only, which is what a phone keyboard expects beside a
              field — and it keeps the field as wide as the message. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !draft.trim() || sending, busy: sending }}
            disabled={!draft.trim() || sending}
            onPress={() => void send()}
            style={({ pressed }) => [
              {
                width: 46,
                height: 46,
                borderRadius: radius.sm,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: rgb(theme.brand),
              },
              pressed && { opacity: 0.75 },
              (!draft.trim() || sending) && { opacity: 0.45 },
            ]}
          >
            {sending ? (
              <ActivityIndicator size="small" color={rgb(theme.brandFg)} />
            ) : (
              <PaperPlaneRight size={18} weight="fill" color={rgb(theme.brandFg)} />
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}
