import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';

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
 * The conversation between the two people handling a pairing.
 *
 * In an agency this is where the work actually happens: two agents comparing
 * notes about a match long before the families are introduced. It used to be a
 * page of its own called Proposals, which meant a pairing lived in two places —
 * the interest on one screen and the discussion about it on another, joined
 * only by a truncated uuid the agent had to recognise.
 *
 * It is keyed on an interest, so it belongs on the interest. Here it opens
 * underneath the row it is about.
 */
export default function ProposalThread({ interestId }: { interestId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [error, setError] = useState('');

  const { data: thread, isError } = useQuery({
    queryKey: ['proposal', interestId],
    queryFn: async () => (await api.get(`/circulation/proposals/${interestId}`)).data as Thread,
    retry: false,
  });

  async function post(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/circulation/proposals/${interestId}/notes`, { body });
      setBody('');
      qc.invalidateQueries({ queryKey: ['proposal', interestId] });
    } catch (err) {
      setError(apiMessage(err, 'That note was not posted.'));
    }
  }

  // No thread is the ordinary case for a match with nobody's agent on the
  // other side, so it says nothing rather than reporting an error.
  if (isError || !thread) return null;

  return (
    <div className="mt-2 rounded bg-gray-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        With the other side
      </p>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {thread.sides.map((side) => (
          <div
            key={side.profile.id}
            className={`rounded border p-2 text-sm ${
              side.isMine ? 'border-brand bg-brand-light' : 'border-gray-200 bg-white'
            }`}
          >
            <p className="font-medium">{side.profile.displayName}</p>
            <p className="text-xs text-gray-500">
              {side.isMine ? 'Your client' : (side.handledBy ?? 'Handled directly')}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
        {thread.notes.length === 0 && (
          <p className="text-sm text-gray-400">No notes yet.</p>
        )}
        {thread.notes.map((n) => (
          <div
            key={n.id}
            className={`max-w-[85%] rounded p-2 text-sm ${
              n.mine ? 'ml-auto bg-brand text-white' : 'bg-white text-gray-800 shadow-sm'
            }`}
          >
            <p>{n.body}</p>
            <p className={`mt-1 text-[10px] ${n.mine ? 'text-white/70' : 'text-gray-400'}`}>
              {new Date(n.createdAt).toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      <form onSubmit={post} className="mt-2 flex gap-2">
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
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
