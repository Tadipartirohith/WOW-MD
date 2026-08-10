import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

interface Suggestion {
  profile: { userId: string; displayName: string; city?: string; bio?: string };
  score: number;
}

export default function Matches() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['suggestions'],
    queryFn: async () => (await api.get('/matches/suggestions')).data,
    retry: false,
  });

  async function sendInterest(toUserId: string) {
    await api.post('/matches/interest', { toUserId });
    qc.invalidateQueries({ queryKey: ['suggestions'] });
  }

  const suggestions: Suggestion[] = data?.data ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-brand-dark">Suggested Matches</h1>
      {isLoading && <p className="text-gray-500">Loading...</p>}
      {!isLoading && suggestions.length === 0 && (
        <p className="text-gray-500">No suggestions yet. Complete your profile to improve matching.</p>
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
