import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { Permission, can } from '../lib/permissions';
import ClientSelector from '../components/ClientSelector';

interface Suggestion {
  profile: { userId: string; displayName: string; city?: string; bio?: string };
  score: number;
}

interface Interest {
  id: string;
  fromUserId: string;
  status: string;
}

export default function Matches() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isAgent = can(permissions, Permission.CLIENT_ACT_ON_BEHALF);
  const canRespond = can(permissions, Permission.MATCH_RESPOND_INTEREST);

  // Agents browse under a client identity; the server requires it for them.
  const [onBehalfOf, setOnBehalfOf] = useState('');
  const [error, setError] = useState('');

  const params = isAgent && onBehalfOf ? { onBehalfOfUserId: onBehalfOf } : {};
  const ready = !isAgent || Boolean(onBehalfOf);

  const { data, isLoading } = useQuery({
    queryKey: ['suggestions', onBehalfOf],
    queryFn: async () => (await api.get('/matches/suggestions', { params })).data,
    retry: false,
    enabled: ready,
  });

  const { data: incoming } = useQuery({
    queryKey: ['incoming-interests', onBehalfOf],
    queryFn: async () => (await api.get('/matches/incoming', { params })).data as Interest[],
    retry: false,
    enabled: ready,
  });

  async function run(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['suggestions'] });
      qc.invalidateQueries({ queryKey: ['incoming-interests'] });
    } catch (err) {
      const msg = (err as AxiosError<{ message?: string | string[] }>).response?.data?.message;
      setError(Array.isArray(msg) ? msg.join('. ') : msg || 'That action was rejected.');
    }
  }

  const sendInterest = (toUserId: string) =>
    run(() => api.post('/matches/interest', { toUserId, ...params }));

  const respond = (id: string, accept: boolean) =>
    run(() => api.put(`/matches/${id}/${accept ? 'accept' : 'reject'}`));

  const suggestions: Suggestion[] = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-bold text-brand-dark">Suggested Matches</h1>
        {isAgent && (
          <ClientSelector
            value={onBehalfOf}
            onChange={setOnBehalfOf}
            label="Browsing as client"
            allowSelf={false}
          />
        )}
      </div>

      {isAgent && !onBehalfOf && (
        <p className="card text-sm text-gray-600">
          Matchmaking runs under a client identity. Pick one of your clients above to browse
          suggestions and send interests on their behalf.
        </p>
      )}

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {ready && (incoming?.length ?? 0) > 0 && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-gray-900">Interests received</h2>
          {incoming!.map((i) => (
            <div key={i.id} className="flex items-center justify-between border-b py-2 last:border-0">
              <span className="text-sm text-gray-600">From {i.fromUserId.slice(0, 8)}…</span>
              {canRespond && (
                <div className="flex gap-2">
                  <button className="btn" onClick={() => respond(i.id, true)}>
                    Accept
                  </button>
                  <button className="btn-outline" onClick={() => respond(i.id, false)}>
                    Decline
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isLoading && <p className="text-gray-500">Loading...</p>}
      {ready && !isLoading && suggestions.length === 0 && (
        <p className="text-gray-500">
          No suggestions yet. Complete the profile to improve matching.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {suggestions.map((s) => (
          <div key={s.profile.userId} className="card">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{s.profile.displayName}</h2>
              <span className="rounded-full bg-brand-light px-2 py-0.5 text-xs font-medium text-brand-dark">
                {s.score}% match
              </span>
            </div>
            <p className="text-sm text-gray-500">{s.profile.city}</p>
            {s.profile.bio && <p className="mt-2 text-sm text-gray-600">{s.profile.bio}</p>}
            <button className="btn mt-3 w-full" onClick={() => sendInterest(s.profile.userId)}>
              Send interest
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
