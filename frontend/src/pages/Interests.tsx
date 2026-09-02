import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { Permission, can } from '../lib/permissions';
import ProfileSelector from '../components/ProfileSelector';
import ProposalThread from '../components/ProposalThread';
import ProfilePreview from '../components/ProfilePreview';
import { EmptyState } from '../components/ui/Feedback';
import { HandHeart, UsersThree } from '@phosphor-icons/react';
import { Loading } from '../components/ui/Feedback';

interface Counterpart {
  id: string;
  displayName: string;
  city: string | null;
  ageRange: string | null;
  gender: string | null;
  photoUrl?: string | null;
  photos?: string[];
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
  const isSteward = can(permissions, Permission.ACT_ON_BEHALF);

  const [profileId, setProfileId] = useState('');
  const [tab, setTab] = useState<TabKey>('received');
  const [error, setError] = useState('');
  const [openThread, setOpenThread] = useState<string | null>(null);
  /** Which counterpart's profile is open, if any. */
  const [previewId, setPreviewId] = useState('');

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
    }
  }

  const rows = board ? board[tab] : [];

  return (
    <div className="space-y-4">
      {previewId && <ProfilePreview profileId={previewId} onClose={() => setPreviewId('')} />}

      <div>
        <h1 className="page-title">Interests</h1>
        <p className="page-subtitle">
          Who has asked about this profile, who it has asked, and what came of each one.
        </p>
      </div>

      {isSteward && (
        <ProfileSelector value={profileId} onChange={setProfileId} label="For which client" />
      )}

      {error && <p className="alert-critical">{error}</p>}

      {!ready && (
        <div className="card">
          <EmptyState icon={UsersThree} title="Pick a client">
            Interests belong to a profile, not to your account. Choose whose you want to see.
          </EmptyState>
        </div>
      )}

      {ready && (
        <>
          <nav className="flex flex-wrap gap-1 border-b border-gray-200">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                  tab === t.key
                    ? 'border-brand font-medium text-brand-dark'
                    : 'border-transparent text-gray-500 hover:text-gray-800'
                }`}
              >
                {t.label}
                {board && board.counts[t.key] > 0 && (
                  <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 text-xs text-gray-600">
                    {board.counts[t.key]}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {isLoading && <Loading rows={3} />}

          {!isLoading && rows.length === 0 && (
            <div className="card">
              <EmptyState icon={HandHeart} title={`No ${(TABS.find((t) => t.key === tab)?.label ?? '').toLowerCase()} interests`}>
                {TABS.find((t) => t.key === tab)?.empty}
              </EmptyState>
            </div>
          )}

          <div className="space-y-2">
            {rows.map((row) => (
              <div key={row.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {(row.counterpart.photoUrl ?? row.counterpart.photos?.[0]) && (
                      <img
                        src={row.counterpart.photoUrl ?? row.counterpart.photos?.[0]}
                        alt=""
                        className="h-12 w-12 rounded-full object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900">
                        {row.counterpart.displayName}
                      </p>
                      <p className="text-xs text-gray-500">
                        {[row.counterpart.city, row.counterpart.ageRange]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {/*
                        Which way it went, said in words. "Interest accepted"
                        with no indication of who accepted was a real
                        complaint, and a row that does not say whether you
                        asked or were asked has the same problem.
                      */}
                      <p className="mt-0.5 text-xs text-gray-400">
                        {row.direction === 'incoming'
                          ? `They asked about you · ${new Date(row.createdAt).toLocaleDateString()}`
                          : `You asked about them · ${new Date(row.createdAt).toLocaleDateString()}`}
                      </p>
                      {/*
                        "Accepted" on its own, with no name against it, was the
                        complaint. Somebody who has sent five interests and
                        received three cannot tell from the word alone whether
                        they agreed to this or somebody agreed to them.
                      */}
                      {row.acceptedBy && (
                        <p className="mt-0.5 text-xs text-emerald-700">
                          {row.acceptedBy.mine
                            ? 'You accepted this'
                            : `Accepted by ${row.acceptedBy.displayName}`}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/*
                      Look before answering.

                      A received interest showed a name, a city and an age band,
                      and asked for a decision on that. The same preview the
                      Matches page uses is right here — the profile is already
                      identified, and what it discloses is decided by the
                      server's own rules rather than by which screen asked.
                    */}
                    <button className="btn-outline" onClick={() => setPreviewId(row.counterpart.id)}>
                      View profile
                    </button>
                    {row.actions.accept && (
                      <button
                        className="btn"
                        onClick={() => void act(() => api.put(`/matches/${row.id}/accept`, {}))}
                      >
                        Accept
                      </button>
                    )}
                    {row.actions.decline && (
                      <button
                        className="btn-outline"
                        onClick={() => void act(() => api.put(`/matches/${row.id}/reject`, {}))}
                      >
                        Decline
                      </button>
                    )}
                    {row.actions.unsend && (
                      <button
                        className="btn-outline"
                        onClick={() => void act(() => api.put(`/matches/${row.id}/withdraw`, {}))}
                      >
                        Unsend
                      </button>
                    )}
                    {row.actions.block && (
                      <button
                        className="btn-outline"
                        onClick={() => {
                          // Blocking is not undoable from here and removes the
                          // person from every future list, so it asks.
                          if (
                            !window.confirm(
                              `Block ${row.counterpart.displayName}? They will not appear again and are not told why.`,
                            )
                          ) {
                            return;
                          }
                          void act(() => api.put(`/matches/${row.id}/block`, {}));
                        }}
                      >
                        Block
                      </button>
                    )}
                    {isSteward && row.status === 'accepted' && (
                      <button
                        className="btn-outline"
                        onClick={() => setOpenThread(openThread === row.id ? null : row.id)}
                      >
                        {openThread === row.id ? 'Hide notes' : 'Notes with their agent'}
                      </button>
                    )}
                  </div>
                </div>

                {isSteward && openThread === row.id && <ProposalThread interestId={row.id} />}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
