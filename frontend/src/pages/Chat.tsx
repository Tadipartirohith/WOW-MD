import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface Match {
  id: string;
  fromUserId: string;
  toUserId: string;
}
interface Message {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
}

export default function Chat() {
  const [withUserId, setWithUserId] = useState('');
  const [body, setBody] = useState('');

  const { data: accepted } = useQuery({
    queryKey: ['accepted'],
    queryFn: async () => (await api.get('/matches/accepted')).data as Match[],
  });

  const { data: history, refetch } = useQuery({
    queryKey: ['history', withUserId],
    queryFn: async () => (await api.get('/chat/messages', { params: { withUserId } })).data,
    enabled: !!withUserId,
    refetchInterval: 3000, // simple polling; Socket.io is wired server-side for real-time
  });

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!withUserId || !body) return;
    await api.post('/chat/messages', { toUserId: withUserId, body });
    setBody('');
    refetch();
  }

  const messages: Message[] = history?.data ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-brand-dark">Messages</h1>
      <div>
        <label className="label">Chat with (accepted match user id)</label>
        <select className="input max-w-md" value={withUserId} onChange={(e) => setWithUserId(e.target.value)}>
          <option value="">select a match</option>
          {(accepted ?? []).map((m) => (
            <option key={m.id} value={m.fromUserId === withUserId ? m.toUserId : m.toUserId}>
              {m.fromUserId} and {m.toUserId}
            </option>
          ))}
        </select>
      </div>

      {withUserId && (
        <div className="card">
          <div className="mb-3 h-72 space-y-2 overflow-y-auto">
            {messages.length === 0 && <p className="text-sm text-gray-400">No messages yet.</p>}
            {[...messages].reverse().map((m) => (
              <div key={m.id} className="rounded bg-gray-100 px-3 py-2 text-sm">
                <span className="text-gray-800">{m.body}</span>
                <span className="ml-2 text-xs text-gray-400">{new Date(m.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
          <form onSubmit={send} className="flex gap-2">
            <input className="input" placeholder="Type a message..." value={body} onChange={(e) => setBody(e.target.value)} />
            <button className="btn">Send</button>
          </form>
        </div>
      )}
    </div>
  );
}
