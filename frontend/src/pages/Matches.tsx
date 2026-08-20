import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import {
  MatchFixedState,
  OnboardingStage,
  ONBOARDING_LABEL,
  Permission,
  ProfileClaimStatus,
  can,
} from '../lib/permissions';
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

/** Where this profile stands: the dashboard strip at the top of the page. */
interface MatchStatus {
  profileId: string;
  profileCompleted: boolean;
  stage: OnboardingStage;
  matchFixedState: MatchFixedState;
  awaitingOtherSide: boolean;
  interestId: string | null;
  counterpartProfileId: string | null;
  servicesUnlocked: boolean;
}

export default function Matches() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isSteward = can(permissions, Permission.ACT_ON_BEHALF);
  const isAgent = can(permissions, Permission.AGENCY_MANAGE);
  const canRespond = can(permissions, Permission.MATCH_RESPOND_INTEREST);
  const canFix = can(permissions, Permission.MATCH_FIX);
  const canEnd = can(permissions, Permission.MATCH_LIFECYCLE);

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

  const { data: status } = useQuery({
    queryKey: ['match-status', profileId],
    queryFn: async () => (await api.get('/matches/status', { params })).data as MatchStatus,
    retry: false,
    enabled: ready,
  });

  const { data: accepted } = useQuery({
    queryKey: ['accepted-matches', profileId],
    queryFn: async () => (await api.get('/matches/accepted', { params })).data as InterestView[],
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
      qc.invalidateQueries({ queryKey: ['accepted-matches'] });
      qc.invalidateQueries({ queryKey: ['match-status'] });
    } catch (err) {
      setError(apiMessage(err, 'That action was rejected.'));
    }
  }

  const sendInterest = (toProfileId: string) =>
    run(() => api.post('/matches/interest', { toProfileId, ...params }));

  const respond = (id: string, accept: boolean) =>
    run(() => api.put(`/matches/${id}/${accept ? 'accept' : 'reject'}`));

  const confirmFixed = (id: string, side?: 'from' | 'to') =>
    run(() => api.put(`/matches/${id}/match-fixed`, side ? { side } : {}));

  const endMatch = (id: string, action: 'unmatch' | 'block', reason?: string) =>
    run(() => api.put(`/matches/${id}/${action}`, reason ? { reason } : {}));

  const report = (id: string, reason: string) =>
    run(() => api.post(`/matches/${id}/report`, { reason }));

  const suggestions: Suggestion[] = data?.data ?? [];
  const acceptedMatches: InterestView[] = accepted ?? [];
  const fixed = status?.matchFixedState === 'confirmed';

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
                  {canEnd && (
                    <button
                      className="btn-outline text-red-600"
                      onClick={() => endMatch(i.id, 'block')}
                    >
                      Block
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {ready && status && (
        <div className="card space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-gray-900">{ONBOARDING_LABEL[status.stage]}</p>
              <p className="text-sm text-gray-600">
                {status.stage === 'profile_incomplete' &&
                  'Fill in the basics — name, gender, date of birth and city — before browsing.'}
                {status.stage === 'matchmaking_active' &&
                  'Browsing and sending interests. Wedding services open once a match is fixed.'}
                {status.stage === 'match_fixed' &&
                  'The match is fixed. Matchmaking is closed and the wedding marketplace is open.'}
              </p>
            </div>
            {status.matchFixedState === 'pending_confirmation' && (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                {status.awaitingOtherSide
                  ? 'Waiting on the other side to confirm'
                  : 'They have confirmed — your turn'}
              </span>
            )}
          </div>
        </div>
      )}

      {ready && acceptedMatches.length > 0 && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-gray-900">Your matches</h2>
          <p className="text-sm text-gray-600">
            Fixing a match takes a confirmation from both sides. The second one closes matchmaking,
            opens the wedding services, and creates accounts for anyone who did not have one.
          </p>
          {acceptedMatches.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b py-2 last:border-0"
            >
              <div>
                <p className="font-medium">{m.counterpart.displayName}</p>
                <p className="text-sm text-gray-500">
                  {[m.counterpart.city, m.counterpart.ageRange].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canFix && !fixed && (
                  <button className="btn" onClick={() => confirmFixed(m.id)}>
                    Confirm match fixed
                  </button>
                )}
                {canEnd && !fixed && (
                  <>
                    <button className="btn-outline" onClick={() => endMatch(m.id, 'unmatch')}>
                      Unmatch
                    </button>
                    <button
                      className="btn-outline text-red-600"
                      onClick={() => endMatch(m.id, 'block')}
                    >
                      Block
                    </button>
                    <button
                      className="btn-outline text-red-600"
                      onClick={() => {
                        const reason = window.prompt(
                          'What happened? An officer will look into it.',
                        );
                        if (reason && reason.trim().length >= 10) report(m.id, reason.trim());
                      }}
                    >
                      Report
                    </button>
                  </>
                )}
              </div>
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
