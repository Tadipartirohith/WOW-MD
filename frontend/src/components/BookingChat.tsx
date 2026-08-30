import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';

/**
 * The conversation about one job.
 *
 * Deliberately not a chat screen with a booking picker. Everything said here is
 * about this booking, which is what lets the rules exist at all: it opens when
 * the advance is held, and it stops taking messages when the job is finished —
 * still readable, because what was agreed in it is what a dispute turns on.
 *
 * The server decides both, and says why in a sentence this renders verbatim.
 * Re-deriving "can I type?" from the booking status here would be a second
 * copy of the rule, and the two would disagree the first time one changed.
 */
export default function BookingChat({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    enabled: Boolean(state?.open),
    // The other side is typing on their own schedule, so this polls rather than
    // waiting for a reason to refetch.
    refetchInterval: 15000,
    retry: false,
  });

  const me = useAuth((st) => st.user?.id);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    try {
      await api.post(`/bookings/${bookingId}/messages`, { body });
      setDraft('');
      qc.invalidateQueries({ queryKey: ['booking-chat', bookingId] });
    } catch (err) {
      setError(apiMessage(err));
    }
  }

  const messages = [...(thread?.data ?? [])].reverse();

  return (
    <div className="border-t pt-3">
      <h3 className="text-sm font-semibold text-gray-900">Conversation</h3>
      <p className="text-xs text-gray-500">{state?.note ?? 'Loading…'}</p>

      {state?.open && (
        <div className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded bg-gray-50 p-3">
          {messages.length === 0 && (
            <p className="text-sm text-gray-400">Nothing said yet.</p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[80%] rounded px-3 py-2 text-sm ${
                m.senderId === me
                  ? 'ml-auto bg-brand text-brand-fg'
                  : 'bg-surface text-gray-800 shadow-sm'
              }`}
            >
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p
                className={`mt-1 text-[10px] ${
                  m.senderId === me ? 'text-brand-fg/70' : 'text-gray-400'
                }`}
              >
                {new Date(m.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}

      {state?.canSend && (
        <div className="mt-2 flex gap-2">
          <input
            className="input flex-1"
            value={draft}
            placeholder="Message about this booking"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send();
            }}
          />
          <button className="btn" onClick={() => void send()} disabled={!draft.trim()}>
            Send
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
