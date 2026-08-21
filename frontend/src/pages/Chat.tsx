import { FormEvent, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { useCall } from '../lib/useCall';
import CallPanel from '../components/CallPanel';

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
}

interface Message {
  id: string;
  senderId: string;
  body: string;
  redactedCount: number;
  createdAt: string;
}

/**
 * Messages.
 *
 * The conversation list is the screen, not a dropdown of user ids. Picking a
 * row opens that thread — which is the whole point and, until now, the thing
 * that did not happen: the picker wrote the same id into state whichever way
 * the match ran, so half of all matches opened a conversation with yourself.
 */
export default function Chat() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [withUserId, setWithUserId] = useState(params.get('with') ?? '');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const { data: conversations = [], isLoading } = useQuery<Conversation[]>({
    queryKey: ['conversations'],
    queryFn: async () => (await api.get('/chat/conversations')).data,
    refetchInterval: 15_000,
  });

  const { data: history } = useQuery({
    queryKey: ['history', withUserId],
    queryFn: async () => (await api.get('/chat/messages', { params: { withUserId } })).data,
    enabled: Boolean(withUserId),
    refetchInterval: 4000,
  });

  const { data: presence } = useQuery({
    queryKey: ['presence', withUserId],
    queryFn: async () => (await api.get('/chat/presence', { params: { withUserId } })).data,
    enabled: Boolean(withUserId),
    refetchInterval: 30_000,
  });

  const call = useCall();
  const messages: Message[] = [...(history?.data ?? [])].reverse();
  const active = conversations.find((c) => c.withUserId === withUserId);

  // Opening a thread clears its badge, and the URL carries the selection so a
  // notification can link straight into a conversation.
  useEffect(() => {
    if (!withUserId) return;
    setParams({ with: withUserId }, { replace: true });
    api
      .put('/chat/messages/read', {}, { params: { withUserId } })
      .then(() => qc.invalidateQueries({ queryKey: ['conversations'] }))
      .catch(() => undefined);
  }, [withUserId, setParams, qc]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!withUserId || !body.trim()) return;
    setError('');
    try {
      await api.post('/chat/messages', { toUserId: withUserId, body });
      setBody('');
      qc.invalidateQueries({ queryKey: ['history', withUserId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (err) {
      setError(apiMessage(err, 'That message was not sent.'));
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Messages</h1>
        <p className="text-sm text-gray-600">
          Phone numbers and email addresses are removed before a message is stored — keep the
          conversation here until you are both ready.
        </p>
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 md:grid-cols-[18rem,1fr]">
        <div className="card max-h-[32rem] overflow-y-auto p-0">
          {isLoading && <p className="p-4 text-sm text-gray-400">Loading…</p>}
          {!isLoading && conversations.length === 0 && (
            <p className="p-4 text-sm text-gray-400">
              No conversations yet. They start when an interest is accepted, or when you message a
              vendor.
            </p>
          )}
          {conversations.map((c) => (
            <button
              key={c.withUserId}
              onClick={() => setWithUserId(c.withUserId)}
              className={`flex w-full items-start gap-3 border-b border-gray-100 p-3 text-left ${
                withUserId === c.withUserId ? 'bg-brand-light' : 'hover:bg-gray-50'
              }`}
            >
              <span className="relative shrink-0">
                {c.photoUrl ? (
                  <img src={c.photoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-sm text-gray-600">
                    {c.displayName.slice(0, 1).toUpperCase()}
                  </span>
                )}
                {c.online && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"
                    title="Online now"
                  />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-gray-900">
                    {c.displayName}
                  </span>
                  {c.unread > 0 && (
                    <span className="rounded-full bg-brand px-1.5 text-xs font-semibold text-white">
                      {c.unread}
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-gray-500">
                  {c.lastMessage
                    ? `${c.lastMessageMine ? 'You: ' : ''}${c.lastMessage}`
                    : 'No messages yet'}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="card flex min-h-[24rem] flex-col">
          {!withUserId && (
            <p className="m-auto text-sm text-gray-400">Pick a conversation to open it.</p>
          )}

          {withUserId && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                <div>
                  <p className="font-semibold text-gray-900">
                    {active?.displayName ?? 'Conversation'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {presence?.online
                      ? 'Online now'
                      : presence?.lastSeen
                        ? `Last seen ${new Date(presence.lastSeen).toLocaleString()}`
                        : 'Offline'}
                  </p>
                </div>
                {/* Only when they are actually there: a call to somebody
                    offline can only ring out, which teaches people the button
                    does not work. */}
                {presence?.online && call.state === 'idle' && (
                  <div className="flex gap-2">
                    <button className="btn-outline" onClick={() => call.call(withUserId, 'audio')}>
                      Call
                    </button>
                    <button className="btn-outline" onClick={() => call.call(withUserId, 'video')}>
                      Video
                    </button>
                  </div>
                )}
              </div>

              <div className="my-3 flex-1 space-y-2 overflow-y-auto">
                {messages.length === 0 && (
                  <p className="text-sm text-gray-400">No messages yet. Say hello.</p>
                )}
                {messages.map((m) => {
                  const mine = m.senderId !== withUserId;
                  return (
                    <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                          mine ? 'bg-brand text-white' : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p
                          className={`mt-0.5 text-[10px] ${
                            mine ? 'text-white/70' : 'text-gray-400'
                          }`}
                        >
                          {new Date(m.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {m.redactedCount > 0 && ' · contact details removed'}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottom} />
              </div>

              <form onSubmit={send} className="flex gap-2 border-t pt-3">
                <input
                  className="input flex-1"
                  placeholder="Type a message…"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <button className="btn" disabled={!body.trim()}>
                  Send
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      <CallPanel
        state={call.state}
        media={call.media}
        error={call.error}
        withName={
          conversations.find((c) => c.withUserId === (call.peerId ?? withUserId))?.displayName ??
          'them'
        }
        localStream={call.localStream}
        remoteStream={call.remoteStream}
        onAnswer={call.answer}
        onHangUp={call.hangUp}
      />
    </div>
  );
}
