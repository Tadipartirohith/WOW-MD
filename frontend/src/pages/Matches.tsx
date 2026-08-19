import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { Permission, ProfileClaimStatus, can } from '../lib/permissions';
import ProfileSelector from '../components/ProfileSelector';

/** Server-side privacy view: an age band, not a date of birth. */
interface PublicProfile {
  id: string;
  displayName: string;
  gender?: string;
  ageRange: string | null;
  city?: string;
  bio?: string;
  photos: string[];
  photoCount: number;
  matched: boolean;
  claimStatus: ProfileClaimStatus;
  managed: boolean;
}

interface Suggestion {
  profile: PublicProfile;
  score: number;
}

interface InterestView {
  id: string;
  status: string;
  createdAt: string;
  counterpart: PublicProfile;
  direction: 'incoming' | 'outgoing';
}

export default function Matches() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isSteward = can(permissions, Permission.ACT_ON_BEHALF);
  const isAgent = can(permissions, Permission.AGENCY_MANAGE);
  const canRespond = can(permissions, Permission.MATCH_RESPOND_INTEREST);

  // Agents must always name a profile; family members and individuals default
  // to their own unless they pick one they manage.
  const [profileId, setProfileId] = useState('');
  const [error, setError] = useState('');

  const params = profileId ? { profileId } : {};
  const ready = !isAgent || Boolean(profileId);

  const { data, isLoading } = useQuery({
    queryKey: ['suggestions', profileId],
    queryFn: async () => (await api.get('/matches/suggestions', { params })).data,
    retry: false,
    enabled: ready,
  });

  const { data: incoming } = useQuery({
    queryKey: ['incoming-interests', profileId],
    queryFn: async () => (await api.get('/matches/incoming', { params })).data as InterestView[],
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
      setError(apiMessage(err, 'That action was rejected.'));
    }
  }

  const sendInterest = (toProfileId: string) =>
    run(() => api.post('/matches/interest', { toProfileId, ...params }));

  const respond = (id: string, accept: boolean) =>
    run(() => api.put(`/matches/${id}/${accept ? 'accept' : 'reject'}`));

  const suggestions: Suggestion[] = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-bold text-brand-dark">Suggested Matches</h1>
        {isSteward && (
          <ProfileSelector
            value={profileId}
            onChange={setProfileId}
            label={isAgent ? 'Browsing as client' : 'Browsing as'}
          />
        )}
      </div>

      {isAgent && !profileId && (
        <p className="card text-sm text-gray-600">
          Matchmaking always runs under a client identity. Pick one of your profiles above — including
          people you have built a profile for but not yet invited.
        </p>
      )}

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      {ready && (incoming?.length ?? 0) > 0 && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-gray-900">Interests received</h2>
          {incoming!.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-2 last:border-0">
              <div>
                <p className="font-medium">{i.counterpart.displayName}</p>
                <p className="text-sm text-gray-500">
                  {[i.counterpart.city, i.counterpart.ageRange].filter(Boolean).join(' · ')}
                </p>
              </div>
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
          No suggestions yet. Fill in more of the profile — city, date of birth, religion, education
          and lifestyle all feed the compatibility score.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {suggestions.map((s) => (
          <div key={s.profile.id} className="card flex flex-col">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{s.profile.displayName}</h2>
              <span className="rounded-full bg-brand-light px-2 py-0.5 text-xs font-medium text-brand-dark">
                {s.score}% match
              </span>
            </div>
            <p className="text-sm text-gray-500">
              {[s.profile.city, s.profile.ageRange].filter(Boolean).join(' · ')}
            </p>

            {s.profile.photos.length > 0 ? (
              <img
                src={s.profile.photos[0]}
                alt=""
                className="mt-2 h-40 w-full rounded object-cover"
              />
            ) : (
              <div className="mt-2 flex h-40 w-full items-center justify-center rounded bg-gray-50 text-xs text-gray-400">
                {s.profile.photoCount > 0
                  ? `${s.profile.photoCount} photo(s), visible once you match`
                  : 'No photos yet'}
              </div>
            )}

            {s.profile.bio && <p className="mt-2 flex-1 text-sm text-gray-600">{s.profile.bio}</p>}
            {s.profile.managed && (
              <p className="mt-2 text-xs text-gray-400">Represented by an agent</p>
            )}

            <button className="btn mt-3 w-full" onClick={() => sendInterest(s.profile.id)}>
              Send interest
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
