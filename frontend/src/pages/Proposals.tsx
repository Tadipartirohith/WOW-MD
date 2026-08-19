import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';

interface ThreadSummary {
  interestId: string;
  status: string;
  lastNoteAt: string | null;
}

interface ThreadSide {
  profile: { id: string; displayName: string; ageRange: string | null; city?: string };
  handledBy: string | null;
  isMine: boolean;
}

interface Thread {
  interestId: string;
  status: string;
  sides: ThreadSide[];
  notes: { id: string; body: string; authorProfileId: string; mine: boolean; createdAt: string }[];
}

/**
 * The conversation between the two people handling a possible match.
 *
 * In an agency this is where the work actually happens: two agents comparing
 * notes about a pairing long before the families are introduced to each other.
 */
export default function Proposals() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  const { data: threads } = useQuery({
    queryKey: ['proposals'],
    queryFn: async () => (await api.get('/circulation/proposals')).data as ThreadSummary[],
    retry: false,
  });

  const { data: thread } = useQuery({
    queryKey: ['proposal', open],
    queryFn: async () => (await api.get(`/circulation/proposals/${open}`)).data as Thread,
    enabled: Boolean(open),
    retry: false,
  });

  async function post(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/circulation/proposals/${open}/notes`, { body });
      setBody('');
      qc.invalidateQueries({ queryKey: ['proposal', open] });
      qc.invalidateQueries({ queryKey: ['proposals'] });
    } catch (err) {
      setError(apiMessage(err, 'That note was not posted.'));
    }
  }

  const list = threads ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Proposals</h1>
        <p className="text-sm text-gray-500">
          Every pairing you are handling, and the conversation with the agent on the other side.
        </p>
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <div className="card space-y-1">
          <h2 className="mb-2 font-semibold text-gray-900">Pairings</h2>
          {list.length === 0 && (
            <p className="text-sm text-gray-400">
              Nothing yet. Send an interest from a client profile to open one.
            </p>
          )}
          {list.map((t) => (
            <button
              key={t.interestId}
              onClick={() => setOpen(t.interestId)}
              className={`block w-full rounded px-3 py-2 text-left text-sm ${
                open === t.interestId ? 'bg-brand-light text-brand-dark' : 'hover:bg-gray-100'
              }`}
            >
              <span className="font-medium">{t.interestId.slice(0, 8)}…</span>
              <span className="ml-2 text-xs uppercase tracking-wide text-gray-400">{t.status}</span>
              <span className="block text-xs text-gray-400">
                {t.lastNoteAt
                  ? `Last note ${new Date(t.lastNoteAt).toLocaleDateString()}`
                  : 'No notes yet'}
              </span>
            </button>
          ))}
        </div>

        <div className="card">
          {!thread && <p className="text-sm text-gray-400">Pick a pairing to open it.</p>}

          {thread && (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                {thread.sides.map((side) => (
                  <div
                    key={side.profile.id}
                    className={`rounded-lg border p-3 ${
                      side.isMine ? 'border-brand bg-brand-light' : 'border-gray-200'
                    }`}
                  >
                    <p className="font-medium">{side.profile.displayName}</p>
                    <p className="text-sm text-gray-500">
                      {[side.profile.city, side.profile.ageRange].filter(Boolean).join(' · ')}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {side.isMine ? 'Your client' : (side.handledBy ?? 'Handled directly')}
                    </p>
                  </div>
                ))}
              </div>

              <div className="max-h-80 space-y-2 overflow-y-auto">
                {thread.notes.length === 0 && (
                  <p className="text-sm text-gray-400">
                    No notes yet. Open the conversation with the other side.
                  </p>
                )}
                {thread.notes.map((n) => (
                  <div
                    key={n.id}
                    className={`max-w-[85%] rounded-lg p-3 text-sm ${
                      n.mine ? 'ml-auto bg-brand text-white' : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    <p>{n.body}</p>
                    <p className={`mt-1 text-xs ${n.mine ? 'text-white/70' : 'text-gray-400'}`}>
                      {new Date(n.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>

              <form onSubmit={post} className="mt-3 flex gap-2">
                <input
                  className="input flex-1"
                  placeholder="Horoscopes match. Can the families meet on Sunday?"
                  maxLength={2000}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  required
                />
                <button className="btn">Send</button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
