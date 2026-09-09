import { useEffect, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
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
import ChoiceField from '../components/ChoiceField';
import {
  CASTES_BY_RELIGION,
  CITIES,
  KUJA_DOSHAM,
  MOTHER_TONGUES,
  NAKSHATRAS,
  PADAMS,
  PROFESSIONS,
  QUALIFICATIONS,
  RASHIS,
  RELIGIONS,
} from '../lib/reference';
import {
  MARITAL_LABEL,
  MaritalStatus,
  OCCUPATION_LABEL,
  OccupationStatus,
} from '../lib/permissions';
import { formatDate } from '../lib/dates';
import { Loading } from '../components/ui/Feedback';

interface AcceptedMatch {
  id: string;
  status: string;
  createdAt: string;
  counterpart: PublicProfile;
  direction: 'incoming' | 'outgoing';
  score: number;
  /** The counterpart's profile manager relation, or null if self-run (EZ1-I115). */
  managedBy: string | null;
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
  rashi: string;
  star: string;
  padam: string;
  gothram: string;
  kujaDosham: string;
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
  rashi: '',
  star: '',
  padam: '',
  gothram: '',
  kujaDosham: '',
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

/**
 * How each active filter reads on its removable chip.
 *
 * `sort` is deliberately absent: it is always set to something and is not an
 * applied filter (see activeFilterCount), so it never earns a chip.
 */
const FILTER_LABEL: Partial<Record<keyof Filters, string>> = {
  q: 'Search',
  ageMin: 'Age from',
  ageMax: 'Age to',
  heightMinCm: 'Height from',
  heightMaxCm: 'Height to',
  religion: 'Religion',
  caste: 'Community',
  motherTongue: 'Mother tongue',
  city: 'City',
  qualification: 'Education',
  profession: 'Profession',
  maritalStatus: 'Marital status',
  occupationStatus: 'Occupation',
  minScore: 'Min match',
  rashi: 'Rashi',
  star: 'Star',
  padam: 'Padam',
  gothram: 'Gothram',
  kujaDosham: 'Kuja dosham',
  addedWithinDays: 'Added within',
};

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
  // The score and activity of whichever card opened the preview, so the modal
  // can show the same match figure the list did (EZ1-I190). Empty for a preview
  // opened from a notification link, which carries no score.
  const [previewMeta, setPreviewMeta] = useState<{ score?: number; lastActiveAt?: string | null }>(
    {},
  );
  const [pages, setPages] = useState(1);
  const [showShortlist, setShowShortlist] = useState(false);

  const openPreview = (id: string, score?: number, lastActiveAt?: string | null) => {
    setPreviewId(id);
    setPreviewMeta({ score, lastActiveAt });
  };
  const closePreview = () => {
    setPreviewId('');
    setPreviewMeta({});
  };

  // Arriving from an "accepted your interest" notification, open that exact
  // profile straight away instead of dropping the agent on the list to hunt for
  // it (EZ1-I82). The link carries ?profile=<counterpartProfileId>; consume it
  // once so closing the preview does not immediately reopen it.
  const [urlParams, setUrlParams] = useSearchParams();
  useEffect(() => {
    const target = urlParams.get('profile');
    if (!target) return;
    setPreviewId(target);
    urlParams.delete('profile');
    setUrlParams(urlParams, { replace: true });
  }, [urlParams, setUrlParams]);

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

  const clearField = (key: keyof Filters) =>
    setFilters((f) => ({ ...f, [key]: NO_FILTERS[key] }));

  // The default sort is not something the user chose, so it does not count as
  // an applied filter — badging "1 applied" on an untouched page is noise.
  const activeFilters = (Object.entries(filters) as [keyof Filters, string][]).filter(
    ([key, value]) => value !== '' && !(key === 'sort' && value === NO_FILTERS.sort),
  );
  const activeFilterCount = activeFilters.length;

  // A backwards range is a mistake worth catching before it silently returns an
  // empty list. Both layers still work — the server just gets a floor above its
  // ceiling — but saying so is kinder than a blank page.
  const num = (v: string) => (v === '' ? null : Number(v));
  const ageInverted =
    num(filters.ageMin) !== null &&
    num(filters.ageMax) !== null &&
    (num(filters.ageMin) as number) > (num(filters.ageMax) as number);
  const heightInverted =
    num(filters.heightMinCm) !== null &&
    num(filters.heightMaxCm) !== null &&
    (num(filters.heightMinCm) as number) > (num(filters.heightMaxCm) as number);

  // What a chip says after its label — codes read as their labels, and the two
  // "within N days" and "N%" filters carry their unit so the chip stands alone.
  const chipValue = (key: keyof Filters, value: string): string => {
    if (key === 'maritalStatus') return MARITAL_LABEL[value as MaritalStatus] ?? value;
    if (key === 'occupationStatus') return OCCUPATION_LABEL[value as OccupationStatus] ?? value;
    if (key === 'minScore') return `${value}%`;
    if (key === 'addedWithinDays') return `${value} days`;
    if (key === 'heightMinCm' || key === 'heightMaxCm') return `${value} cm`;
    return value;
  };

  const suggestions: Suggestion[] = data?.data ?? [];
  const total: number = data?.meta?.total ?? suggestions.length;
  const acceptedMatches: AcceptedMatch[] = accepted ?? [];
  const fixed = status?.matchFixedState === 'confirmed';
  const shortlistRows: Suggestion[] = shortlist ?? [];
  const recommendedRows = (recommended?.data as Suggestion[] | undefined) ?? [];

  // The one-line summary at the top. Every figure comes off data already
  // loaded — the browse total, the profiles active in the last day, the
  // engine's own 50%+ list, and the private shortlist (EZ1-I189).
  const newToday = suggestions.filter((s) => {
    const la = s.profile.lastActiveAt;
    return la ? (Date.now() - new Date(la).getTime()) / 86_400_000 < 1 : false;
  }).length;
  const summary = [
    { label: 'Total matches', value: total },
    { label: 'Active today', value: newToday },
    { label: 'High compatibility', value: recommendedRows.length },
    { label: 'Shortlisted', value: shortlistRows.length },
  ];

  // The search box, sort, quick pills and clear-all live on the compact bar;
  // everything else opens in the "More filters" panel. This counts only the
  // panel's filters, so the button can say how many are hidden behind it.
  const barKeys = new Set(['q', 'sort', 'minScore', 'addedWithinDays']);
  const advancedCount = activeFilters.filter(([key]) => !barKeys.has(key)).length;

  /*
   * Why the committing buttons are off, said once and reused.
   *
   * Both layers enforce it — the API refuses these calls outright — but a
   * disabled button with no explanation is its own defect. The reason travels
   * with the button rather than being written out beside each list.
   */
  // Identity verification is no longer a matchmaking gate for individual users
  // (EZ1-I70): in-person verification is not part of their flow, so it must not
  // block sending, accepting or fixing an interest.
  const gate = !status
    ? undefined
    : !status.profileCompleted
      ? 'Fill in the profile first: basic details, preferences and a photo.'
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

      {/* At-a-glance counts, all off data already loaded (EZ1-I189). */}
      {ready && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {summary.map((s) => (
            <div
              key={s.label}
              className="rounded-[--radius-lg] border border-gray-200 bg-surface p-4 shadow-card"
            >
              <p className="text-2xl font-semibold tracking-[-0.02em] text-gray-900">{s.value}</p>
              <p className="mt-0.5 text-xs text-gray-500">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {error && <p className="alert-critical">{error}</p>}

      {previewId && (
        <ProfilePreview
          profileId={previewId}
          onClose={closePreview}
          onSendInterest={interestHandler ? () => sendInterest(previewId) : undefined}
          score={previewMeta.score}
          lastActiveAt={previewMeta.lastActiveAt}
        />
      )}

      {/*
        A compact filter bar rather than the tall column the filters used to
        stand in (EZ1-I189): the search box, the sort, the two everyday pills
        and a "More filters" button, with the fourteen advanced filters folded
        into the panel that button opens. Below it, two columns — what fits the
        filters, and what the engine recommends.
      */}
      {ready && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {/*
                One box for name, profile code and keyword. The person typing
                does not think of those as three different searches — they think
                of whichever one they happen to remember.
              */}
              <div className="min-w-[14rem] flex-1">
                <label className="sr-only" htmlFor="match-search">
                  Search
                </label>
                <input
                  id="match-search"
                  className="input"
                  placeholder="Name, profile ID (WOW10231), or a keyword"
                  value={filters.q}
                  onChange={(e) => {
                    setField('q')(e.target.value);
                    setPages(1);
                  }}
                />
              </div>

              <label className="w-full sm:w-48">
                <span className="sr-only">Sort by</span>
                <select
                  className="input"
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

              <button
                className="btn-outline text-xs"
                onClick={() => setShowFilters((f) => !f)}
                aria-expanded={showFilters}
              >
                {showFilters ? 'Fewer filters' : 'More filters'}
                {advancedCount > 0 && ` (${advancedCount})`}
              </button>
              {activeFilterCount > 0 && (
                <button
                  className="btn-ghost text-xs"
                  onClick={() => {
                    setFilters(NO_FILTERS);
                    setPages(1);
                  }}
                >
                  Clear all
                </button>
              )}
            </div>

            {/*
              Each applied filter as a chip that removes itself. The bar says
              how many advanced filters are folded away; a chip says which are
              on, and takes one off without reopening the panel.
            */}
            {activeFilterCount > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {activeFilters.map(([key, value]) => (
                  <button
                    key={key}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-xs text-brand-dark hover:bg-brand-light/70"
                    onClick={() => {
                      clearField(key);
                      setPages(1);
                    }}
                  >
                    <span className="text-brand-dark/60">{FILTER_LABEL[key] ?? key}:</span>
                    {chipValue(key, value)}
                    <X size={11} weight="bold" aria-hidden />
                    <span className="sr-only">Remove filter</span>
                  </button>
                ))}
              </div>
            )}

            {showFilters && (
              <div
                // Full width now, so the panel breathes across two or three
                // columns instead of the single truncated column a sidebar
                // could give it.
                className="grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-3"
              >
                  <Filter label="Age from" value={filters.ageMin} onChange={setField('ageMin')} type="number" />
                  <Filter label="Age to" value={filters.ageMax} onChange={setField('ageMax')} type="number" />
                  {ageInverted && (
                    <p className="text-xs text-red-600">Age from must be less than or equal to age to.</p>
                  )}
                  {/*
                    Searchable dropdowns off the same master data as the biodata
                    fills, not free text — so a filter for "Telugu" cannot miss
                    a profile that stored "telegu", and Occupation/Profession read
                    from the same lists the profile was built from. "Other" keeps
                    a value the list omits.
                  */}
                  <ChoiceField label="City" value={filters.city} onChange={setField('city')} options={CITIES} />
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
                  {heightInverted && (
                    <p className="text-xs text-red-600">
                      Height from must be less than or equal to height to.
                    </p>
                  )}
                  <ChoiceField
                    label="Religion"
                    value={filters.religion}
                    onChange={setField('religion')}
                    options={RELIGIONS}
                  />
                  <ChoiceField
                    label="Caste or community"
                    value={filters.caste}
                    onChange={setField('caste')}
                    options={CASTES_BY_RELIGION[filters.religion] ?? []}
                  />
                  <ChoiceField
                    label="Mother tongue"
                    value={filters.motherTongue}
                    onChange={setField('motherTongue')}
                    options={MOTHER_TONGUES}
                  />
                  <ChoiceField
                    label="Education"
                    value={filters.qualification}
                    onChange={setField('qualification')}
                    options={QUALIFICATIONS}
                  />
                  <ChoiceField
                    label="Profession"
                    value={filters.profession}
                    onChange={setField('profession')}
                    options={PROFESSIONS}
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

                  {/*
                    Horoscope filters (EZ1-I163), off the same lists the biodata
                    chart was filled from — so a filter matches the value a
                    profile actually saved. Rashi, star and padam are closed
                    lists; gothram runs to thousands, so it is a free box like
                    it is on the biodata form.
                  */}
                  <ChoiceField
                    label="Rashi"
                    value={filters.rashi}
                    onChange={setField('rashi')}
                    options={RASHIS}
                    allowOther={false}
                    placeholder="Any"
                  />
                  <ChoiceField
                    label="Star / Nakshatram"
                    value={filters.star}
                    onChange={setField('star')}
                    options={NAKSHATRAS}
                    allowOther={false}
                    placeholder="Any"
                  />
                  <ChoiceField
                    label="Padam"
                    value={filters.padam}
                    onChange={setField('padam')}
                    options={PADAMS}
                    allowOther={false}
                    placeholder="Any"
                  />
                  <Filter label="Gothram" value={filters.gothram} onChange={setField('gothram')} />
                  <ChoiceField
                    label="Kuja Dosham"
                    value={filters.kujaDosham}
                    onChange={setField('kujaDosham')}
                    options={KUJA_DOSHAM}
                    allowOther={false}
                    placeholder="Any"
                  />
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
                <div className="grid gap-2 sm:grid-cols-2">
                  {shortlistRows.map((s) => (
                    <MatchCard
                      key={s.profile.id}
                      suggestion={{ ...s, shortlisted: true }}
                      onOpen={() => openPreview(s.profile.id, s.score, s.profile.lastActiveAt)}
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

            <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
              <div className="card space-y-3">
                <div>
                  <h2 className="section-title">
                    {SORTS.find((s) => s.value === filters.sort)?.label ?? 'Browse'}
                  </h2>
                  <p className="text-sm text-gray-600">
                    Everyone who fits the filters above, whatever the match score. This is
                    browsing, not recommending.
                  </p>
                </div>
                <div className="space-y-2">
                  {suggestions.map((s) => (
                    <MatchCard
                      key={s.profile.id}
                      suggestion={s}
                      // The score families compare across a list, shown on the
                      // browse cards too (EZ1-I189), not only when sorted by it.
                      showScore
                      detail="brief"
                      onOpen={() => openPreview(s.profile.id, s.score, s.profile.lastActiveAt)}
                      onSendInterest={
                        interestHandler ? () => sendInterest(s.profile.id) : undefined
                      }
                      onToggleShortlist={() => toggleShortlist(s)}
                      disabledReason={gate}
                    />
                  ))}
                  {isLoading && <Loading rows={3} />}
                  {!isLoading && suggestions.length === 0 && (
                    <EmptyState
                      hasFilters={activeFilterCount > 0}
                      onClear={() => setFilters(NO_FILTERS)}
                    />
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
                    Rated 50% or better by the matching engine, best first. Unaffected by the
                    filters.
                  </p>
                </div>
                <div className="space-y-2">
                  {recommendedRows.map((s) => (
                    <MatchCard
                      key={s.profile.id}
                      suggestion={s}
                      showScore
                      onOpen={() => openPreview(s.profile.id, s.score, s.profile.lastActiveAt)}
                      onSendInterest={
                        interestHandler ? () => sendInterest(s.profile.id) : undefined
                      }
                      onToggleShortlist={() => toggleShortlist(s)}
                      disabledReason={gate}
                    />
                  ))}
                  {recommendedRows.length === 0 && (
                    <p className="text-sm text-gray-400">
                      Nothing over 50% yet. Filling in more of your preferences gives the engine
                      more to go on.
                    </p>
                  )}
                </div>
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
                  <Thumb
                    url={m.counterpart.photos?.[0]}
                    name={m.counterpart.displayName}
                    className="h-14 w-14 shrink-0 rounded-sm object-cover text-lg"
                  />
                  <div className="min-w-0">
                    <button
                      className="truncate font-medium text-gray-900 hover:underline"
                      onClick={() => openPreview(m.counterpart.id, m.score, m.counterpart.lastActiveAt)}
                    >
                      {m.counterpart.displayName}
                    </button>
                    <p className="font-mono text-xs text-gray-400">{m.counterpart.profileCode}</p>
                    <p className="text-sm text-gray-500">
                      {[m.counterpart.city, m.counterpart.ageRange].filter(Boolean).join(' · ')}
                    </p>
                    {/* Who runs the profile, on the confirmed-match card (EZ1-I115). */}
                    {m.managedBy && (
                      <p className="text-xs text-gray-500">Managed by their {m.managedBy}</p>
                    )}
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

              <ConfirmProgress match={m} />

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="btn-outline text-xs"
                  onClick={() => openPreview(m.counterpart.id, m.score, m.counterpart.lastActiveAt)}
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

/**
 * A small profile photo that falls back to an initial rather than the browser's
 * broken-image icon when the photo is missing or fails to load (EZ1-I190).
 */
function Thumb({ url, name, className }: { url?: string | null; name: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <span
        className={`flex items-center justify-center bg-surface-sunken font-medium text-gray-500 ${className}`}
      >
        {(name || '?').trim().slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className={className} />;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 sm:justify-start">
      <dt className="text-gray-400">{label}</dt>
      <dd className="font-medium text-gray-700">{value}</dd>
    </div>
  );
}

/**
 * The three steps from an accepted interest to a fixed match, as a strip.
 *
 * The dates above say when each thing happened; this says what is left. A
 * family reading "You confirmed / Not yet" twice could not tell whose turn it
 * was — the strip lights the step that is done and names the one that is next.
 */
function ConfirmProgress({ match }: { match: AcceptedMatch }) {
  const youDone = Boolean(match.confirmedByYouAt);
  const themDone = Boolean(match.confirmedByThemAt);
  const complete = match.matchFixedState === 'confirmed';
  const steps = [
    { label: 'You confirmed', done: youDone },
    { label: 'Waiting for them', done: themDone },
    { label: 'Match complete', done: complete },
  ];
  return (
    <ol className="mt-3 flex items-center gap-1 text-[0.6875rem]">
      {steps.map((step, i) => (
        <li key={step.label} className="flex flex-1 items-center gap-1">
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-semibold ${
              step.done ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-400'
            }`}
          >
            {step.done ? '✓' : i + 1}
          </span>
          <span className={step.done ? 'text-gray-700' : 'text-gray-400'}>{step.label}</span>
          {i < steps.length - 1 && (
            <span className={`h-px flex-1 ${step.done ? 'bg-emerald-200' : 'bg-gray-200'}`} />
          )}
        </li>
      ))}
    </ol>
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
        <p className="font-medium text-gray-700">No profiles match your current filters.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-600">
          <li>Widen the age or height range</li>
          <li>Clear the city, good matches are often one town over</li>
          <li>Drop the caste or mother-tongue filter and see what is there</li>
        </ul>
        <button className="btn-outline mt-3 text-xs" onClick={onClear}>
          Clear Filters
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
