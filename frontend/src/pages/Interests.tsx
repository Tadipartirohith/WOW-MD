import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { Permission, can } from '../lib/permissions';
import AgencyInterests from '../components/AgencyInterests';
import ProfileSelector from '../components/ProfileSelector';
import ProposalThread from '../components/ProposalThread';
import ProfilePreview from '../components/ProfilePreview';
import ConfirmDialog from '../components/ConfirmDialog';
import { EmptyState } from '../components/ui/Feedback';
import {
  DotsThreeVertical,
  HandHeart,
  MagnifyingGlass,
  SealCheck,
  UsersThree,
} from '@phosphor-icons/react';
import { Loading } from '../components/ui/Feedback';
import { formatShortDate, relativeToToday } from '../lib/dates';

interface Counterpart {
  id: string;
  displayName: string;
  city: string | null;
  ageRange: string | null;
  gender: string | null;
  photoUrl?: string | null;
  photos?: string[];
  /** The short code a family reads out. Already sent by the server. */
  profileCode?: string | null;
  /** An officer has confirmed the identity document in person. */
  verified?: boolean;
  /** Null when the profile has never signed in. Stands in for last activity. */
  lastActiveAt?: string | null;
}

interface InterestRow {
  id: string;
  status: string;
  createdAt: string;
  direction: 'incoming' | 'outgoing';
  counterpart: Counterpart;
  actions: { accept: boolean; decline: boolean; unsend: boolean; block: boolean };
  acceptedBy: {
    profileId: string;
    displayName: string;
    gender: string | null;
    mine: boolean;
  } | null;
}

interface Board {
  profileId: string;
  received: InterestRow[];
  sent: InterestRow[];
  pending: InterestRow[];
  accepted: InterestRow[];
  declined: InterestRow[];
  withdrawn: InterestRow[];
  blocked: InterestRow[];
  counts: Record<string, number>;
}

type TabKey = 'received' | 'sent' | 'pending' | 'accepted' | 'declined';

const TABS: { key: TabKey; label: string; empty: string }[] = [
  {
    key: 'received',
    label: 'Received',
    empty: 'Nobody has asked about this profile yet. Being complete and having photographs is what changes that.',
  },
  {
    key: 'sent',
    label: 'Sent',
    empty: 'Nothing sent yet. Browse Matches and send an interest to start.',
  },
  {
    key: 'pending',
    label: 'Pending',
    empty: 'Nothing is waiting on an answer, from either side.',
  },
  {
    key: 'accepted',
    label: 'Accepted',
    empty: 'No accepted interests yet. Both sides have to agree before a conversation opens.',
  },
  {
    key: 'declined',
    label: 'Declined',
    empty: 'Nothing declined. It is kept here rather than deleted, so the same profile is not asked twice by mistake.',
  },
];

const PAGE_SIZE = 6;

/** How many days back a "Sent" filter reaches. */
const DATE_WINDOWS: { value: string; label: string }[] = [
  { value: '', label: 'Any time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 3 months' },
];

/**
 * Every interest, in one place.
 *
 * The parts existed — an inbox on the Matches page, a sent list nobody
 * surfaced, accepted matches somewhere else again, and declined ones nowhere
 * at all — so the question people actually ask, *who has asked about me and
 * what came of it*, had no screen that answered it.
 *
 * The buttons come from the server with each row rather than being worked out
 * here. Whether an interest can be declined or unsent depends on its status and
 * on which side you are, and two rows that look identical can allow different
 * things; deciding that in the client would be a second copy of the rule, in
 * the one place that cannot enforce it.
 */
export default function Interests() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const emailVerified = useAuth((s) => s.user?.isVerified);
  const isSteward = can(permissions, Permission.ACT_ON_BEHALF);
  /*
   * An agency sees its whole book first (EZ1-I243).
   *
   * A family steward manages one profile, or two, and the selector is the
   * quickest way to the one they mean. An agent manages dozens, and the page
   * they were sent to by the dashboard card showed nothing until they had
   * picked one — so for them the flat list is the page, and picking a client
   * narrows it to that client's board.
   */
  const isAgency = can(permissions, Permission.AGENCY_MANAGE);

  const [profileId, setProfileId] = useState('');
  const [tab, setTab] = useState<TabKey>('received');
  const [error, setError] = useState('');
  const [openThread, setOpenThread] = useState<string | null>(null);
  /** Which counterpart's profile is open, if any. */
  const [previewId, setPreviewId] = useState('');

  // Local, client-side refinements over the rows the board already returned.
  // None of this touches the server: the board is small and already grouped,
  // so searching and filtering it here is a view concern, not a new query.
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [ageFilter, setAgeFilter] = useState('');
  const [dateWindow, setDateWindow] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);

  /** Which row's overflow menu is open, and any pending confirmation. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    { kind: 'unsend' | 'block'; row: InterestRow } | null
  >(null);
  const [busy, setBusy] = useState(false);

  const [bannerDismissed, setBannerDismissed] = useState(false);

  const params = profileId ? { profileId } : {};
  const ready = !isSteward || Boolean(profileId);

  const { data: board, isLoading } = useQuery<Board>({
    queryKey: ['interest-board', profileId],
    queryFn: async () => (await api.get('/matches/interests', { params })).data,
    enabled: ready,
    retry: false,
  });

  async function act(fn: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['interest-board'] });
      // The same interests drive the Matches inbox and the chat list, so both
      // are dropped rather than left showing an answer that has changed.
      qc.invalidateQueries({ queryKey: ['incoming-interests'] });
      qc.invalidateQueries({ queryKey: ['accepted-matches'] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function switchTab(next: TabKey) {
    setTab(next);
    setShown(PAGE_SIZE);
    setMenuFor(null);
  }

  function resetPaging() {
    setShown(PAGE_SIZE);
  }

  const allRows = board ? board[tab] : [];

  // Distinct cities and age bands actually present in this tab, so the filters
  // only ever offer choices that can return something.
  const cityOptions = useMemo(
    () => Array.from(new Set(allRows.map((r) => r.counterpart.city).filter(Boolean))).sort() as string[],
    [allRows],
  );
  const ageOptions = useMemo(
    () =>
      Array.from(new Set(allRows.map((r) => r.counterpart.ageRange).filter(Boolean))).sort() as string[],
    [allRows],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const windowDays = dateWindow ? Number(dateWindow) : 0;
    const cutoff = windowDays ? Date.now() - windowDays * 86_400_000 : 0;
    return allRows.filter((row) => {
      if (term) {
        const name = row.counterpart.displayName.toLowerCase();
        const code = (row.counterpart.profileCode ?? '').toLowerCase();
        if (!name.includes(term) && !code.includes(term)) return false;
      }
      if (cityFilter && row.counterpart.city !== cityFilter) return false;
      if (ageFilter && row.counterpart.ageRange !== ageFilter) return false;
      if (cutoff && new Date(row.createdAt).getTime() < cutoff) return false;
      return true;
    });
  }, [allRows, search, cityFilter, ageFilter, dateWindow]);

  const visible = filtered.slice(0, shown);
  const filtersActive = Boolean(search || cityFilter || ageFilter || dateWindow);
  const activeTab = TABS.find((t) => t.key === tab);

  function clearFilters() {
    setSearch('');
    setCityFilter('');
    setAgeFilter('');
    setDateWindow('');
    resetPaging();
  }

  return (
    <div className="space-y-4">
      {previewId && <ProfilePreview profileId={previewId} onClose={() => setPreviewId('')} />}

      {confirm && (
        <ConfirmDialog
          title={
            confirm.kind === 'unsend'
              ? 'Take this interest back?'
              : `Block ${confirm.row.counterpart.displayName}?`
          }
          body={
            confirm.kind === 'unsend'
              ? `Your interest in ${confirm.row.counterpart.displayName} will be withdrawn. You can send it again later.`
              : `${confirm.row.counterpart.displayName} will not appear again in either of your lists, and is not told why. This cannot be undone from here.`
          }
          confirmLabel={confirm.kind === 'unsend' ? 'Unsend' : 'Block'}
          cancelLabel="Keep it"
          tone={confirm.kind === 'block' ? 'critical' : 'normal'}
          busy={busy}
          onConfirm={async () => {
            const { kind, row } = confirm;
            await act(() =>
              api.put(`/matches/${row.id}/${kind === 'unsend' ? 'withdraw' : 'block'}`, {}),
            );
            setConfirm(null);
          }}
          onDismiss={() => setConfirm(null)}
        />
      )}

      <div>
        <h1 className="page-title">Interests</h1>
        <p className="page-subtitle">
          {isAgency
            ? 'Every interest across your clients — who asked, who was asked, and what came of it. Pick a client to answer one.'
            : 'Who has asked about this profile, who it has asked, and what came of each one.'}
        </p>
      </div>

      {/*
        A reminder, not a wall. Email verification matters, but it is not what
        this page is for, so it sits in a single caution line the reader can
        dismiss rather than a banner that pushes the interests below the fold.
      */}
      {emailVerified === false && !bannerDismissed && (
        <div className="alert-caution" role="status">
          <span className="flex-1">
            Your email address is not verified yet.{' '}
            <Link className="font-medium underline" to="/security">
              Verify it
            </Link>{' '}
            to keep your account and its matches secure.
          </span>
          <button
            className="shrink-0 rounded-sm px-1.5 font-medium hover:opacity-70"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {isSteward && (
        <ProfileSelector value={profileId} onChange={setProfileId} label="For which client" />
      )}

      {isAgency && !profileId && (
        <AgencyInterests
          onViewProfile={setPreviewId}
          onViewInterest={(clientProfileId) => setProfileId(clientProfileId)}
        />
      )}

      {error && (
        <p className="alert-critical" role="alert">
          {error}
        </p>
      )}

      {!ready && !isAgency && (
        <div className="card">
          <EmptyState icon={UsersThree} title="Pick a client">
            Interests belong to a profile, not to your account. Choose whose you want to see.
          </EmptyState>
        </div>
      )}

      {ready && (
        <>
          <nav className="flex flex-wrap gap-1 border-b border-gray-200">
            {TABS.map((t) => {
              const count = board?.counts[t.key] ?? 0;
              const isActive = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => switchTab(t.key)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? 'border-brand font-semibold text-brand-strong'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {t.label}
                  {count > 0 && (
                    <span
                      className={`rounded-full px-1.5 text-xs ${
                        isActive ? 'bg-brand-soft text-brand-strong' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Search and filters over the current tab. Hidden while a tab is
              genuinely empty — there is nothing to narrow. */}
          {!isLoading && allRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-[14rem] flex-1">
                <MagnifyingGlass
                  size={16}
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  className="input pl-9"
                  placeholder="Search by name or profile ID"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    resetPaging();
                  }}
                />
              </label>
              {cityOptions.length > 1 && (
                <select
                  className="input w-auto"
                  value={cityFilter}
                  onChange={(e) => {
                    setCityFilter(e.target.value);
                    resetPaging();
                  }}
                  aria-label="Filter by city"
                >
                  <option value="">All cities</option>
                  {cityOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
              {ageOptions.length > 1 && (
                <select
                  className="input w-auto"
                  value={ageFilter}
                  onChange={(e) => {
                    setAgeFilter(e.target.value);
                    resetPaging();
                  }}
                  aria-label="Filter by age range"
                >
                  <option value="">Any age</option>
                  {ageOptions.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              )}
              <select
                className="input w-auto"
                value={dateWindow}
                onChange={(e) => {
                  setDateWindow(e.target.value);
                  resetPaging();
                }}
                aria-label="Filter by date sent"
              >
                {DATE_WINDOWS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
              {filtersActive && (
                <button className="btn-ghost btn-sm" onClick={clearFilters}>
                  Clear
                </button>
              )}
            </div>
          )}

          {isLoading && <Loading rows={3} />}

          {/* Nothing at all in this tab. */}
          {!isLoading && allRows.length === 0 && (
            <div className="card">
              <EmptyState
                icon={HandHeart}
                title={`No ${(activeTab?.label ?? '').toLowerCase()} interests`}
                action={
                  <Link className="btn" to="/matches">
                    Explore matches
                  </Link>
                }
              >
                {activeTab?.empty}
              </EmptyState>
            </div>
          )}

          {/* Rows exist, but the filters hide all of them. */}
          {!isLoading && allRows.length > 0 && filtered.length === 0 && (
            <div className="card">
              <EmptyState
                icon={MagnifyingGlass}
                title="Nothing matches those filters"
                action={
                  <button className="btn-outline" onClick={clearFilters}>
                    Clear filters
                  </button>
                }
              >
                Widen the search or clear a filter to see the rest of this list.
              </EmptyState>
            </div>
          )}

          <div className="space-y-2">
            {visible.map((row) => (
              <div key={row.id} className="card p-4">
                <div className="flex gap-3">
                  <Avatar counterpart={row.counterpart} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate font-medium text-gray-900">
                            {row.counterpart.displayName}
                          </p>
                          {row.counterpart.verified && (
                            <SealCheck
                              size={15}
                              weight="fill"
                              className="shrink-0 text-brand"
                              aria-label="Verified"
                            />
                          )}
                        </div>
                        {row.counterpart.profileCode && (
                          <p className="font-mono text-xs text-gray-400">
                            {row.counterpart.profileCode}
                          </p>
                        )}
                      </div>
                      <StatusBadge row={row} />
                    </div>

                    {/* The facts a card is useless without, on one line so the
                        row stays compact: where, how old, when it was sent, and
                        when they were last around. */}
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                      {row.counterpart.city && <span>{row.counterpart.city}</span>}
                      {row.counterpart.ageRange && <span>{row.counterpart.ageRange}</span>}
                      <span>
                        {row.direction === 'incoming' ? 'Received' : 'Sent'}{' '}
                        {formatShortDate(row.createdAt)}
                      </span>
                      {row.counterpart.lastActiveAt && (
                        <span>Active {relativeToToday(row.counterpart.lastActiveAt)}</span>
                      )}
                    </div>

                    {/*
                      Which way it went and what came of it, in words. "Accepted"
                      with no name against it was a real complaint: somebody who
                      has sent five interests and received three cannot tell from
                      the word alone whether they agreed or somebody agreed to
                      them.
                    */}
                    <p className="mt-1 text-xs text-gray-400">
                      {row.direction === 'incoming'
                        ? 'They asked about you'
                        : 'You asked about them'}
                    </p>
                    {row.acceptedBy && (
                      <p className="mt-0.5 text-xs text-positive-fg">
                        {row.acceptedBy.mine
                          ? 'You accepted this'
                          : `Accepted by ${row.acceptedBy.displayName}`}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {/*
                        Look before answering. The same preview the Matches page
                        uses is right here, and what it discloses is decided by
                        the server's rules rather than by which screen asked.
                        Accepting a received interest is the loud action; viewing
                        is the quiet default everywhere else.
                      */}
                      {row.actions.accept ? (
                        <>
                          <button
                            className="btn btn-sm"
                            disabled={busy}
                            onClick={() => void act(() => api.put(`/matches/${row.id}/accept`, {}))}
                          >
                            Accept
                          </button>
                          <button
                            className="btn-outline btn-sm"
                            onClick={() => setPreviewId(row.counterpart.id)}
                          >
                            View profile
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn-sm"
                          onClick={() => setPreviewId(row.counterpart.id)}
                        >
                          View profile
                        </button>
                      )}

                      {row.actions.decline && (
                        <button
                          className="btn-outline btn-sm"
                          disabled={busy}
                          onClick={() => void act(() => api.put(`/matches/${row.id}/reject`, {}))}
                        >
                          Decline
                        </button>
                      )}
                      {row.actions.unsend && (
                        <button
                          className="btn-outline btn-sm"
                          onClick={() => setConfirm({ kind: 'unsend', row })}
                        >
                          Unsend
                        </button>
                      )}

                      {/* Block, and the steward's notes, are the less-used
                          actions. They live behind the overflow menu so the
                          destructive one is never the easy click. */}
                      {(row.actions.block || (isSteward && row.status === 'accepted')) && (
                        <div className="relative">
                          <button
                            className="btn-ghost btn-sm"
                            aria-label="More actions"
                            aria-haspopup="menu"
                            onClick={() => setMenuFor(menuFor === row.id ? null : row.id)}
                          >
                            <DotsThreeVertical size={18} weight="bold" aria-hidden />
                          </button>
                          {menuFor === row.id && (
                            <>
                              <button
                                className="fixed inset-0 z-20 cursor-default"
                                aria-hidden
                                tabIndex={-1}
                                onClick={() => setMenuFor(null)}
                              />
                              <div
                                role="menu"
                                className="absolute right-0 z-30 mt-1 w-52 rounded-sm border border-gray-200 bg-surface p-1 shadow-pop"
                              >
                                {isSteward && row.status === 'accepted' && (
                                  <button
                                    role="menuitem"
                                    className="block w-full rounded-sm px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                                    onClick={() => {
                                      setOpenThread(openThread === row.id ? null : row.id);
                                      setMenuFor(null);
                                    }}
                                  >
                                    {openThread === row.id ? 'Hide notes' : 'Notes with their agent'}
                                  </button>
                                )}
                                {row.actions.block && (
                                  <button
                                    role="menuitem"
                                    className="block w-full rounded-sm px-2 py-1.5 text-left text-sm text-critical-fg hover:bg-critical-bg"
                                    onClick={() => {
                                      setMenuFor(null);
                                      setConfirm({ kind: 'block', row });
                                    }}
                                  >
                                    Block {row.counterpart.displayName}
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {isSteward && openThread === row.id && <ProposalThread interestId={row.id} />}
              </div>
            ))}
          </div>

          {filtered.length > shown && (
            <button className="btn-outline w-full" onClick={() => setShown((n) => n + PAGE_SIZE)}>
              Load more ({filtered.length - shown} more)
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** The counterpart's photo, or their initial when there is none. */
function Avatar({ counterpart }: { counterpart: Counterpart }) {
  const src = counterpart.photoUrl ?? counterpart.photos?.[0];
  if (src) {
    return <img src={src} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand-soft text-lg font-semibold text-brand-strong">
      {counterpart.displayName.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * The one word that says where this interest stands.
 *
 * Status alone is not enough for a pending row — the same "pending" is a
 * request you owe an answer to or one you are waiting on, and those read
 * differently — so direction decides the wording on that one.
 */
function StatusBadge({ row }: { row: InterestRow }) {
  switch (row.status) {
    case 'accepted':
      return <span className="pill-positive shrink-0">Accepted</span>;
    case 'rejected':
      return <span className="pill-neutral shrink-0">Declined</span>;
    case 'withdrawn':
      return <span className="pill-neutral shrink-0">Unsent</span>;
    case 'blocked':
      return <span className="pill-critical shrink-0">Blocked</span>;
    case 'pending':
      return row.direction === 'incoming' ? (
        <span className="pill-brand shrink-0">Needs your reply</span>
      ) : (
        <span className="pill-caution shrink-0">Awaiting reply</span>
      );
    default:
      return <span className="pill-neutral shrink-0">{row.status}</span>;
  }
}
