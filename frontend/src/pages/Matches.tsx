import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import ProfilePreview from '../components/ProfilePreview';
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
import { MARITAL_LABEL, OCCUPATION_LABEL } from '../lib/permissions';

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

interface Filters {
  ageMin: string;
  ageMax: string;
  heightMinCm: string;
  heightMaxCm: string;
  religion: string;
  caste: string;
  motherTongue: string;
  city: string;
  qualification: string;
  maritalStatus: string;
  occupationStatus: string;
  minScore: string;
  sort: string;
  addedWithinDays: string;
}

const NO_FILTERS: Filters = {
  ageMin: '',
  ageMax: '',
  heightMinCm: '',
  heightMaxCm: '',
  religion: '',
  caste: '',
  motherTongue: '',
  city: '',
  qualification: '',
  maritalStatus: '',
  occupationStatus: '',
  minScore: '',
  sort: '',
  addedWithinDays: '',
};

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
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  // Which profile is open, if any. A name that is not clickable is the
  // reported defect; this is what it opens.
  const [previewId, setPreviewId] = useState('');

  const params = profileId ? { profileId } : {};
  const ready = !isAgent || Boolean(profileId);

  // Blank fields are omitted rather than sent as empty strings, so an untouched
  // filter genuinely does nothing on the server.
  const searchParams = {
    ...params,
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['suggestions', profileId, JSON.stringify(filters)],
    queryFn: async () => (await api.get('/matches/suggestions', { params: searchParams })).data,
    retry: false,
    enabled: ready,
  });

  /**
   * The newest profiles, in the order they arrived.
   *
   * Browsing rather than recommending, so the compatibility floor does not
   * apply: somebody who joined this morning and happens not to match your
   * preferences still belongs on a list called "recently added". Applying the
   * floor here is what made it look empty.
   */
  const { data: recent } = useQuery({
    queryKey: ['recent-profiles', profileId],
    queryFn: async () =>
      (await api.get('/matches/suggestions', { params: { ...params, sort: 'recent', limit: 12 } }))
        .data,
    retry: false,
    enabled: ready,
  });

  // The engine's own shortlist, unfiltered — it answers a different question
  // from the browse list below and is deliberately unaffected by those filters.
  const { data: recommended } = useQuery({
    queryKey: ['recommended', profileId],
    queryFn: async () => (await api.get('/ai/recommendations/matches', { params })).data,
    retry: false,
    enabled: ready && can(permissions, Permission.AI_ASSIST),
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

  const setField = (key: keyof Filters) => (value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const activeFilterCount = Object.values(filters).filter((v) => v !== '').length;

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

      {previewId && (
        <ProfilePreview
          profileId={previewId}
          onClose={() => setPreviewId('')}
          onSendInterest={fixed ? undefined : () => sendInterest(previewId)}
        />
      )}

      {/*
        Three panels, which is how the page is meant to read: what you are
        filtering by on the left, what is new in the middle, what the engine
        recommends on the right.

        They were stacked before — two lists side by side with the filters
        underneath them — so the control that changes the lists sat below the
        lists it changed, and on a laptop you scrolled past the answer to reach
        the question. Below `lg` they stack in the same order, because three
        columns on a phone is one column with the words squeezed.
      */}
      {ready && (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr_1fr] lg:items-start">
          {/* Left: the filters, open by default where there is room for them. */}
          <div className="lg:sticky lg:top-4">
  <div className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-gray-900">Narrow the list</h2>
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-brand-light px-2 py-0.5 text-xs text-brand-dark">
                    {activeFilterCount} applied
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {activeFilterCount > 0 && (
                  <button className="btn-outline" onClick={() => setFilters(NO_FILTERS)}>
                    Clear
                  </button>
                )}
                <button className="btn-outline" onClick={() => setShowFilters((f) => !f)}>
                  {showFilters ? 'Hide' : 'Filters'}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                className={pill(filters.sort === 'recent')}
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    sort: f.sort === 'recent' ? '' : 'recent',
                    addedWithinDays: f.sort === 'recent' ? '' : '30',
                  }))
                }
              >
                Recently added
              </button>
              <button
                className={pill(filters.minScore === '50')}
                onClick={() =>
                  setFilters((f) => ({ ...f, minScore: f.minScore === '50' ? '' : '50' }))
                }
              >
                50% match and above
              </button>
            </div>

            {showFilters && (
              <div
                  // One field per row on a wide screen: the panel is a sidebar
                  // now, and three columns inside eighteen rems is three
                  // columns of truncated labels.
                  className="grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-1"
                >
                <Filter label="Age from" value={filters.ageMin} onChange={setField('ageMin')} type="number" />
                <Filter label="Age to" value={filters.ageMax} onChange={setField('ageMax')} type="number" />
                <Filter label="City" value={filters.city} onChange={setField('city')} />
                <Filter
                  label="Height from (cm)"
                  value={filters.heightMinCm}
                  onChange={setField('heightMinCm')}
                  type="number"
                />
                <Filter
                  label="Height to (cm)"
                  value={filters.heightMaxCm}
                  onChange={setField('heightMaxCm')}
                  type="number"
                />
                <Filter label="Religion" value={filters.religion} onChange={setField('religion')} />
                <Filter label="Caste" value={filters.caste} onChange={setField('caste')} />
                <Filter
                  label="Mother tongue"
                  value={filters.motherTongue}
                  onChange={setField('motherTongue')}
                />
                <Filter
                  label="Qualification"
                  value={filters.qualification}
                  onChange={setField('qualification')}
                />
                <label className="block text-sm">
                  <span className="text-gray-700">Marital status</span>
                  <select
                    className="input mt-1"
                    value={filters.maritalStatus}
                    onChange={(e) => setField('maritalStatus')(e.target.value)}
                  >
                    <option value="">Any</option>
                    {Object.entries(MARITAL_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-gray-700">Occupation</span>
                  <select
                    className="input mt-1"
                    value={filters.occupationStatus}
                    onChange={(e) => setField('occupationStatus')(e.target.value)}
                  >
                    <option value="">Any</option>
                    {Object.entries(OCCUPATION_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
          </div>


          <div className="card space-y-2">
            <div>
              <h2 className="font-semibold text-gray-900">Recently added</h2>
              <p className="text-sm text-gray-600">
                The newest profiles first, whatever the match score. This is browsing, not
                recommending.
              </p>
            </div>
            <div className="space-y-2">
              {(recent?.data as Suggestion[] | undefined)?.slice(0, 8).map((s) => (
                <PersonRow
                  key={s.profile.id}
                  suggestion={s}
                  showScore={false}
                  onOpen={() => setPreviewId(s.profile.id)}
                  onSendInterest={fixed ? undefined : () => sendInterest(s.profile.id)}
                />
              ))}
              {(recent?.data?.length ?? 0) === 0 && (
                <p className="text-sm text-gray-400">Nothing new since you last looked.</p>
              )}
            </div>
          </div>

          <div className="card space-y-2">
            <div>
              <h2 className="font-semibold text-gray-900">Recommended for you</h2>
              <p className="text-sm text-gray-600">
                Rated 50% or better by the matching engine, best first.
              </p>
            </div>
            <div className="space-y-2">
              {(recommended?.data as Suggestion[] | undefined)?.map((s) => (
                <PersonRow
                  key={s.profile.id}
                  suggestion={s}
                  showScore
                  onOpen={() => setPreviewId(s.profile.id)}
                  onSendInterest={fixed ? undefined : () => sendInterest(s.profile.id)}
                />
              ))}
              {(recommended?.data?.length ?? 0) === 0 && (
                <p className="text-sm text-gray-400">
                  Nothing over 50% yet. Filling in more of your preferences gives the engine more
                  to go on.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

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
                  (status.servicesUnlocked
                    ? 'Browsing and sending interests. The wedding marketplace is open to you now — you do not have to wait for a match.'
                    : 'Browsing and sending interests. Wedding services open once a match is fixed.')}
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

/** A filter chip, on or off. */
function pill(active: boolean): string {
  return active
    ? 'rounded-full border border-brand bg-brand-light px-3 py-1 text-sm text-brand-dark'
    : 'rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50';
}

function Filter({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700">{label}</span>
      <input
        className="input mt-1"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * One person in a list.
 *
 * The name is a button. It used to be text, with nothing behind it — which is
 * the reported defect, and the reason a match could be listed but never
 * looked at.
 */
function PersonRow({
  suggestion,
  showScore,
  onOpen,
  onSendInterest,
}: {
  suggestion: Suggestion;
  showScore: boolean;
  onOpen: () => void;
  onSendInterest?: () => void;
}) {
  const p = suggestion.profile;
  return (
    <div className="flex items-center gap-3 rounded border border-gray-200 p-2">
      {p.photos?.[0] ? (
        <img src={p.photos[0]} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-gray-100 text-sm text-gray-500">
          {(p.displayName ?? '?').slice(0, 1).toUpperCase()}
        </span>
      )}
      <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <span className="block truncate font-medium text-gray-900 hover:underline">
          {p.displayName}
        </span>
        <span className="block truncate text-xs text-gray-500">
          {[p.city, p.ageRange].filter(Boolean).join(' \u00b7 ')}
        </span>
      </button>
      {showScore && (
        <span className="shrink-0 rounded-full bg-brand-light px-2 py-0.5 text-xs font-semibold text-brand-dark">
          {suggestion.score}%
        </span>
      )}
      {onSendInterest && (
        <button className="btn-outline shrink-0 text-xs" onClick={onSendInterest}>
          Interest
        </button>
      )}
    </div>
  );
}
