import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import ProfilePreview from '../components/ProfilePreview';
import MatchCard, { PublicProfile, Suggestion } from '../components/MatchCard';
import { useAuth } from '../store/auth';
import {
  MatchFixedState,
  OnboardingStage,
  ONBOARDING_LABEL,
  Permission,
  can,
} from '../lib/permissions';
import ProfileSelector from '../components/ProfileSelector';
import { MARITAL_LABEL, OCCUPATION_LABEL } from '../lib/permissions';
import { formatDate } from '../lib/dates';
import { Loading } from '../components/ui/Feedback';

interface AcceptedMatch {
  id: string;
  status: string;
  createdAt: string;
  counterpart: PublicProfile;
  direction: 'incoming' | 'outgoing';
  score: number;
  matchFixedState: MatchFixedState;
  confirmedByYouAt: string | null;
  confirmedByThemAt: string | null;
  fixedAt: string | null;
}

/** Where this profile stands: the strip at the top of the page. */
interface MatchStatus {
  profileId: string;
  profileCompleted: boolean;
  stage: OnboardingStage;
  matchFixedState: MatchFixedState;
  awaitingOtherSide: boolean;
  interestId: string | null;
  counterpartProfileId: string | null;
  servicesUnlocked: boolean;
  identitySubmitted: boolean;
  identityVerified: boolean;
}

interface Filters {
  q: string;
  ageMin: string;
  ageMax: string;
  heightMinCm: string;
  heightMaxCm: string;
  religion: string;
  caste: string;
  motherTongue: string;
  city: string;
  qualification: string;
  profession: string;
  maritalStatus: string;
  occupationStatus: string;
  minScore: string;
  sort: string;
  addedWithinDays: string;
}

const NO_FILTERS: Filters = {
  q: '',
  ageMin: '',
  ageMax: '',
  heightMinCm: '',
  heightMaxCm: '',
  religion: '',
  caste: '',
  motherTongue: '',
  city: '',
  qualification: '',
  profession: '',
  maritalStatus: '',
  occupationStatus: '',
  minScore: '',
  /*
   * Newest first by default, because the middle panel is "recently added" and
   * the filters beside it are what shape it. Somebody who wants it scored
   * instead has the sort control.
   */
  sort: 'recent',
  addedWithinDays: '',
};

/** The orders worth offering, in the words a family would use. */
const SORTS: { value: string; label: string }[] = [
  { value: 'recent', label: 'Recently added' },
  { value: 'score', label: 'Best match' },
  { value: 'active', label: 'Recently active' },
  { value: 'age', label: 'Youngest first' },
  { value: 'ageDesc', label: 'Oldest first' },
];

const PAGE_SIZE = 12;

/**
 * Discovering, viewing and managing potential matches — and nothing else.
 *
 * The interest inbox that used to sit at the bottom of this page has moved out
 * entirely. Received, sent, pending, accepted and declined all live on
 * Interests, which is the screen built to answer "who has asked about me and
 * what came of it". Two screens each doing half of both jobs is how a profile
 * ended up appearing on this page three times.
 *
 * What stays here: the filters, what is new, what the engine recommends, the
 * shortlist, and the matches that have actually been agreed.
 */
export default function Matches() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isSteward = can(permissions, Permission.ACT_ON_BEHALF);
  const isAgent = can(permissions, Permission.AGENCY_MANAGE);
  const canFix = can(permissions, Permission.MATCH_FIX);
  const canEnd = can(permissions, Permission.MATCH_LIFECYCLE);

  const [profileId, setProfileId] = useState('');
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [previewId, setPreviewId] = useState('');
  const [pages, setPages] = useState(1);
  const [showShortlist, setShowShortlist] = useState(false);

  const params = profileId ? { profileId } : {};
  const ready = !isAgent || Boolean(profileId);

  // Blank fields are omitted rather than sent as empty strings, so an untouched
  // filter genuinely does nothing on the server.
  const searchParams = {
    ...params,
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')),
    limit: PAGE_SIZE * pages,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['suggestions', profileId, JSON.stringify(filters), pages],
    queryFn: async () => (await api.get('/matches/suggestions', { params: searchParams })).data,
    retry: false,
    enabled: ready,
  });

  // The engine's own shortlist, unfiltered — it answers a different question
  // from the browse list and is deliberately unaffected by those filters.
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
    queryFn: async () => (await api.get('/matches/accepted', { params })).data as AcceptedMatch[],
    retry: false,
    enabled: ready,
  });

  const { data: shortlist } = useQuery({
    queryKey: ['shortlist', profileId],
    queryFn: async () => (await api.get('/matches/shortlist', { params })).data as Suggestion[],
    retry: false,
    enabled: ready,
  });

  async function run(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['suggestions'] });
      qc.invalidateQueries({ queryKey: ['recommended'] });
      qc.invalidateQueries({ queryKey: ['shortlist'] });
      qc.invalidateQueries({ queryKey: ['interest-board'] });
      qc.invalidateQueries({ queryKey: ['accepted-matches'] });
      qc.invalidateQueries({ queryKey: ['match-status'] });
    } catch (err) {
      setError(apiMessage(err, 'That action was rejected.'));
    }
  }

  const sendInterest = (toProfileId: string) =>
    run(() => api.post('/matches/interest', { toProfileId, ...params }));

  const toggleShortlist = (target: Suggestion) =>
    run(() =>
      target.shortlisted
        ? api.delete(`/matches/shortlist/${target.profile.id}`, { params })
        : api.put(`/matches/shortlist/${target.profile.id}`, {}, { params }),
    );

  const confirmFixed = (id: string, side?: 'from' | 'to') =>
    run(() => api.put(`/matches/${id}/match-fixed`, side ? { side } : {}));

  const endMatch = (id: string, action: 'unmatch' | 'block', reason?: string) =>
    run(() => api.put(`/matches/${id}/${action}`, reason ? { reason } : {}));

  const report = (id: string, reason: string) =>
    run(() => api.post(`/matches/${id}/report`, { reason }));

  const setField = (key: keyof Filters) => (value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));

  // The default sort is not something the user chose, so it does not count as
  // an applied filter — badging "1 applied" on an untouched page is noise.
  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) => value !== '' && !(key === 'sort' && value === NO_FILTERS.sort),
  ).length;

  const suggestions: Suggestion[] = data?.data ?? [];
  const total: number = data?.meta?.total ?? suggestions.length;
  const acceptedMatches: AcceptedMatch[] = accepted ?? [];
  const fixed = status?.matchFixedState === 'confirmed';
  const shortlistRows: Suggestion[] = shortlist ?? [];

  /*
   * Why the committing buttons are off, said once and reused.
   *
   * Both layers enforce it — the API refuses these calls outright — but a
   * disabled button with no explanation is its own defect. The reason travels
   * with the button rather than being written out beside each list.
   */
  const gate = !status
    ? undefined
    : !status.profileCompleted
      ? 'Fill in the profile first: basic details, preferences and a photo.'
      : !status.identityVerified
        ? status.identitySubmitted
          ? 'Identity verification is still pending. An officer confirms the document in person.'
          : 'Identity verification is required before you can send or accept an interest.'
        : fixed
          ? 'This profile has a fixed match, so matchmaking is closed.'
          : undefined;

  const interestHandler = gate ? undefined : sendInterest;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Matches</h1>
          <p className="page-subtitle">
            Finding and judging profiles. Who has asked about you lives on{' '}
            <Link className="text-brand-dark underline" to="/interests">
              Interests
            </Link>
            .
          </p>
        </div>
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
          Matchmaking always runs under a client identity. Pick one of your profiles above,
          including people you have built a profile for but not yet invited.
        </p>
      )}

      {error && <p className="alert-critical">{error}</p>}

      {/*
        The verification gate, stated where the buttons it disables are.
        Browsing stays open deliberately: somebody who has not verified yet
        still needs to see what is on the other side of the step.
      */}
      {ready && status && !status.identityVerified && (
        <div className="card border-l-4 border-amber-400 bg-amber-50">
          <p className="font-medium text-amber-900">
            {status.identitySubmitted
              ? 'Identity verification is pending'
              : 'Identity verification is required'}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {status.identitySubmitted
              ? 'The document is on file. A verification officer confirms it against the person, and interests open as soon as that is done. You can keep browsing in the meantime.'
              : 'Browsing is open, but sending an interest, accepting one and fixing a match all wait on it. Add a document on the biodata and an officer will confirm it.'}
          </p>
          {!status.identitySubmitted && (
            <Link className="btn mt-2 inline-block text-xs" to="/biodata">
              Add an identity document
            </Link>
          )}
        </div>
      )}

      {previewId && (
        <ProfilePreview
          profileId={previewId}
          onClose={() => setPreviewId('')}
          onSendInterest={interestHandler ? () => sendInterest(previewId) : undefined}
        />
      )}

      {/*
        Three panels: what you are filtering by on the left, what is new in the
        middle, what the engine recommends on the right. Below `lg` they stack
        in the same order, because three columns on a phone is one column with
        the words squeezed.
      */}
      {ready && (
        <div className="grid gap-4 lg:grid-cols-[19rem_1fr_1fr] lg:items-start">
          <div className="space-y-4 lg:sticky lg:top-4">
            <div className="card space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <h2 className="section-title">Narrow the list</h2>
                  {activeFilterCount > 0 && (
                    <span className="rounded-full bg-brand-light px-2 py-0.5 text-xs text-brand-dark">
                      {activeFilterCount} applied
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {activeFilterCount > 0 && (
                    <button
                      className="btn-outline text-xs"
                      onClick={() => {
                        setFilters(NO_FILTERS);
                        setPages(1);
                      }}
                    >
                      Clear
                    </button>
                  )}
                  <button className="btn-outline text-xs" onClick={() => setShowFilters((f) => !f)}>
                    {showFilters ? 'Fewer' : 'More filters'}
                  </button>
                </div>
              </div>

              {/*
                One box for name, profile code and keyword. The person typing
                does not think of those as three different searches — they think
                of whichever one they happen to remember.
              */}
              <label className="block text-sm">
                <span className="text-gray-700">Search</span>
                <input
                  className="input mt-1"
                  placeholder="Name, profile ID (WOW10231), or a keyword"
                  value={filters.q}
                  onChange={(e) => {
                    setField('q')(e.target.value);
                    setPages(1);
                  }}
                />
              </label>

              <label className="block text-sm">
                <span className="text-gray-700">Sort by</span>
                <select
                  className="input mt-1"
                  value={filters.sort}
                  onChange={(e) => {
                    setField('sort')(e.target.value);
                    setPages(1);
                  }}
                >
                  {SORTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  className={pill(filters.minScore === '50')}
                  onClick={() =>
                    setFilters((f) => ({ ...f, minScore: f.minScore === '50' ? '' : '50' }))
                  }
                >
                  50%+ match
                </button>
                <button
                  className={pill(filters.addedWithinDays === '30')}
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      addedWithinDays: f.addedWithinDays === '30' ? '' : '30',
                    }))
                  }
                >
                  Added this month
                </button>
              </div>

              {showFilters && (
                <div
                  // One field per row on a wide screen: the panel is a sidebar,
                  // and three columns inside nineteen rems is three columns of
                  // truncated labels.
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
                  <Filter
                    label="Caste or community"
                    value={filters.caste}
                    onChange={setField('caste')}
                  />
                  <Filter
                    label="Mother tongue"
                    value={filters.motherTongue}
                    onChange={setField('motherTongue')}
                  />
                  <Filter
                    label="Education"
                    value={filters.qualification}
                    onChange={setField('qualification')}
                  />
                  <Filter
                    label="Profession"
                    value={filters.profession}
                    onChange={setField('profession')}
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

            <div className="card space-y-2">
              <button
                className="flex w-full items-center justify-between text-left"
                onClick={() => setShowShortlist((s) => !s)}
              >
                <span className="font-semibold text-gray-900">Shortlist</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  {shortlistRows.length}
                </span>
              </button>
              {showShortlist && (
                <div className="space-y-2">
                  {shortlistRows.map((s) => (
                    <MatchCard
                      key={s.profile.id}
                      suggestion={{ ...s, shortlisted: true }}
                      onOpen={() => setPreviewId(s.profile.id)}
                      onSendInterest={
                        interestHandler ? () => sendInterest(s.profile.id) : undefined
                      }
                      onToggleShortlist={() => toggleShortlist({ ...s, shortlisted: true })}
                      disabledReason={gate}
                    />
                  ))}
                  {shortlistRows.length === 0 && (
                    <p className="text-sm text-gray-400">
                      Nothing kept yet. Shortlisting is private. The other family is never told.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="card space-y-3">
            <div>
              <h2 className="section-title">
                {SORTS.find((s) => s.value === filters.sort)?.label ?? 'Browse'}
              </h2>
              <p className="text-sm text-gray-600">
                Everyone who fits the filters beside this, whatever the match score. This is
                browsing, not recommending.
              </p>
            </div>
            <div className="space-y-2">
              {suggestions.map((s) => (
                <MatchCard
                  key={s.profile.id}
                  suggestion={s}
                  showScore={filters.sort === 'score'}
                  // Browsing, not recommending: name, age and profession, and
                  // the profile itself for anything more.
                  detail="brief"
                  onOpen={() => setPreviewId(s.profile.id)}
                  onSendInterest={interestHandler ? () => sendInterest(s.profile.id) : undefined}
                  onToggleShortlist={() => toggleShortlist(s)}
                  disabledReason={gate}
                />
              ))}
              {isLoading && <Loading rows={3} />}
              {!isLoading && suggestions.length === 0 && (
                <EmptyState hasFilters={activeFilterCount > 0} onClear={() => setFilters(NO_FILTERS)} />
              )}
              {suggestions.length < total && (
                <button className="btn-outline w-full" onClick={() => setPages((p) => p + 1)}>
                  Load more ({total - suggestions.length} more)
                </button>
              )}
            </div>
          </div>

          <div className="card space-y-3">
            <div>
              <h2 className="section-title">Recommended for you</h2>
              <p className="text-sm text-gray-600">
                Rated 50% or better by the matching engine, best first. Unaffected by the filters.
              </p>
            </div>
            <div className="space-y-2">
              {(recommended?.data as Suggestion[] | undefined)?.map((s) => (
                <MatchCard
                  key={s.profile.id}
                  suggestion={s}
                  showScore
                  onOpen={() => setPreviewId(s.profile.id)}
                  onSendInterest={interestHandler ? () => sendInterest(s.profile.id) : undefined}
                  onToggleShortlist={() => toggleShortlist(s)}
                  disabledReason={gate}
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

      {ready && status && (
        <div className="card space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-gray-900">{ONBOARDING_LABEL[status.stage]}</p>
              <p className="text-sm text-gray-600">
                {status.stage === 'profile_incomplete' &&
                  'Fill in the basics: name, gender, date of birth and city: before browsing.'}
                {status.stage === 'matchmaking_active' &&
                  (status.servicesUnlocked
                    ? 'Browsing and sending interests. The wedding marketplace is open to you now. You do not have to wait for a match.'
                    : 'Browsing and sending interests. Wedding services open once a match is fixed.')}
                {status.stage === 'match_fixed' &&
                  'The match is fixed. Matchmaking is closed and the wedding marketplace is open.'}
              </p>
            </div>
            {status.matchFixedState === 'pending_confirmation' && (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                {status.awaitingOtherSide
                  ? 'Waiting on the other side to confirm'
                  : 'They have confirmed, your turn'}
              </span>
            )}
          </div>
        </div>
      )}

      {/*
        Confirmed matches, said in full.

        "Match Fixed" as a heading with a name under it was reported as
        unclear, and fairly: it did not say whose match, who had confirmed,
        when, or what to do next. Each of those is a separate fact and each one
        is now on the card.
      */}
      {ready && acceptedMatches.length > 0 && (
        <div className="card space-y-3">
          <div>
            <h2 className="section-title">Confirmed matches</h2>
            <p className="text-sm text-gray-600">
              Both sides accepted the interest. Fixing the match takes a confirmation from each.
              The second one closes matchmaking, opens the wedding services, and creates accounts
              for anyone who did not have one.
            </p>
          </div>
          {acceptedMatches.map((m) => (
            <div key={m.id} className="rounded-lg border border-gray-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 gap-3">
                  {m.counterpart.photos?.[0] && (
                    <img
                      src={m.counterpart.photos[0]}
                      alt=""
                      className="h-14 w-14 shrink-0 rounded-sm object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    <button
                      className="truncate font-medium text-gray-900 hover:underline"
                      onClick={() => setPreviewId(m.counterpart.id)}
                    >
                      {m.counterpart.displayName}
                    </button>
                    <p className="font-mono text-xs text-gray-400">{m.counterpart.profileCode}</p>
                    <p className="text-sm text-gray-500">
                      {[m.counterpart.city, m.counterpart.ageRange].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="rounded-full bg-brand-light px-2 py-0.5 text-sm font-semibold text-brand-dark">
                    {m.score}% match
                  </span>
                  <FixedBadge match={m} />
                </div>
              </div>

              <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-gray-600 sm:grid-cols-2">
                <Fact label="Interest accepted" value={formatDate(m.createdAt)} />
                <Fact
                  label="You confirmed"
                  value={m.confirmedByYouAt ? formatDate(m.confirmedByYouAt) : 'Not yet'}
                />
                <Fact
                  label="They confirmed"
                  value={m.confirmedByThemAt ? formatDate(m.confirmedByThemAt) : 'Not yet'}
                />
                <Fact
                  label="Match fixed"
                  value={m.fixedAt ? formatDate(m.fixedAt) : 'Waiting on both confirmations'}
                />
              </dl>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="btn-outline text-xs"
                  onClick={() => setPreviewId(m.counterpart.id)}
                >
                  View profile
                </button>
                <Link className="btn-outline text-xs" to="/chat">
                  Message
                </Link>
                {canFix && m.matchFixedState !== 'confirmed' && !m.confirmedByYouAt && (
                  <button
                    className="btn text-xs"
                    onClick={() => confirmFixed(m.id)}
                    disabled={Boolean(gate) && !fixed}
                    title={fixed ? undefined : gate}
                  >
                    Confirm match fixed
                  </button>
                )}
                {canEnd && m.matchFixedState !== 'confirmed' && (
                  <>
                    <button className="btn-outline text-xs" onClick={() => endMatch(m.id, 'unmatch')}>
                      Unmatch
                    </button>
                    <button
                      className="btn-outline text-xs text-red-600"
                      onClick={() => endMatch(m.id, 'block')}
                    >
                      Block
                    </button>
                    <button
                      className="btn-outline text-xs text-red-600"
                      onClick={() => {
                        const reason = window.prompt('What happened? An officer will look into it.');
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
    </div>
  );
}

/** A filter chip, on or off. */
function pill(active: boolean): string {
  return active
    ? 'rounded-full border border-brand bg-brand-light px-3 py-1 text-sm text-brand-dark'
    : 'rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50';
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 sm:justify-start">
      <dt className="text-gray-400">{label}</dt>
      <dd className="font-medium text-gray-700">{value}</dd>
    </div>
  );
}

function FixedBadge({ match }: { match: AcceptedMatch }) {
  if (match.matchFixedState === 'confirmed') {
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">
        Match fixed
      </span>
    );
  }
  if (match.confirmedByYouAt) {
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
        Waiting on them
      </span>
    );
  }
  if (match.confirmedByThemAt) {
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
        Your turn to confirm
      </span>
    );
  }
  return (
    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
      Neither side has confirmed
    </span>
  );
}

/**
 * An empty list that says what to do about it.
 *
 * "No matches found" is true and useless. Which of the two empties this is
 * decides the advice: a filtered list that came back empty is a filter
 * problem, and an unfiltered one is a preferences problem.
 */
function EmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  if (hasFilters) {
    return (
      <div className="rounded-sm border border-dashed border-gray-300 p-4 text-sm">
        <p className="font-medium text-gray-700">Nothing matches those filters.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600">
          <li>Widen the age or height range</li>
          <li>Clear the city, good matches are often one town over</li>
          <li>Drop the caste or mother-tongue filter and see what is there</li>
        </ul>
        <button className="btn-outline mt-3 text-xs" onClick={onClear}>
          Clear all filters
        </button>
      </div>
    );
  }
  return (
    <div className="rounded-sm border border-dashed border-gray-300 p-4 text-sm">
      <p className="font-medium text-gray-700">No suitable profiles yet.</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600">
        <li>
          <Link className="text-brand-dark underline" to="/biodata">
            Complete the biodata
          </Link>.{' '}
          A profile with photographs and details is shown far more often
        </li>
        <li>Update the partner preferences, or broaden the age and location you will consider</li>
        <li>Check back in a few days; new profiles arrive every week</li>
      </ul>
    </div>
  );
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
