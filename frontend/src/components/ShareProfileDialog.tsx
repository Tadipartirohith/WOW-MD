import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import ConsentFields, { ConsentDraft, consentPayload, emptyConsent } from './ConsentFields';

interface ConsentState {
  mayCirculate: boolean;
  needsReconfirmation: boolean;
  reason: string | null;
  circulation: { expiresAt: string | null } | null;
}

interface AgentEntry {
  userId: string;
  agencyName: string;
  city: string | null;
}

interface ShareRow {
  id: string;
  audience: 'agent' | 'user' | 'link';
  recipientUserId: string | null;
  message: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

type Mode = 'agent' | 'user' | 'link' | 'pool';

/**
 * Where an agent actually circulates a biodata: to another agency, to a family
 * that already has an account, as a link for WhatsApp, or into the shared pool.
 *
 * Everything here is gated on circulation consent, so the first thing the panel
 * does is say whether that consent exists — and offer to record it if not,
 * rather than letting the agent hit a 403 and guess why.
 */
export default function ShareProfileDialog({
  profileId,
  profileName,
  pooled,
  onClose,
}: {
  profileId: string;
  profileName: string;
  pooled: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('agent');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [link, setLink] = useState('');

  const [agentSearch, setAgentSearch] = useState('');
  const [agentUserId, setAgentUserId] = useState('');
  const [userId, setUserId] = useState('');
  const [message, setMessage] = useState('');
  const [days, setDays] = useState('30');
  const [consent, setConsent] = useState<ConsentDraft>(emptyConsent());
  const [recording, setRecording] = useState(false);

  const { data: consentState } = useQuery({
    queryKey: ['consent', profileId],
    queryFn: async () =>
      (await api.get(`/circulation/profiles/${profileId}/consent`)).data as ConsentState,
    retry: false,
  });

  const { data: agents } = useQuery({
    queryKey: ['agent-directory', agentSearch],
    queryFn: async () =>
      (await api.get('/circulation/agents', { params: agentSearch ? { q: agentSearch } : {} })).data,
    enabled: mode === 'agent',
    retry: false,
  });

  const { data: shares } = useQuery({
    queryKey: ['profile-shares', profileId],
    queryFn: async () =>
      (await api.get(`/circulation/profiles/${profileId}/shares`)).data as ShareRow[],
    retry: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['profile-shares', profileId] });
    qc.invalidateQueries({ queryKey: ['managed-profiles'] });
    qc.invalidateQueries({ queryKey: ['consent', profileId] });
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(ok);
      invalidate();
    } catch (err) {
      setError(apiMessage(err, 'That did not go through.'));
    }
  };

  const revoke = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/circulation/shares/${id}`)).data,
    onSuccess: () => {
      setNotice('Withdrawn. The recipient can no longer see it.');
      invalidate();
    },
    onError: (err) => setError(apiMessage(err)),
  });

  async function recordCirculationConsent(e: FormEvent) {
    e.preventDefault();
    setRecording(true);
    await run(
      () =>
        api.post(`/circulation/profiles/${profileId}/consent`, {
          scope: 'circulation',
          ...consentPayload(consent, false),
        }),
      'Consent recorded. You can circulate this profile now.',
    );
    setRecording(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'agent') {
      await run(
        () => api.post('/circulation/share/agent', { profileId, agentUserId, message }),
        'Shared with that agency.',
      );
    } else if (mode === 'user') {
      await run(
        () => api.post('/circulation/share/user', { profileId, userId, message }),
        'Shared with that account.',
      );
    } else if (mode === 'link') {
      setError('');
      try {
        const { data } = await api.post('/circulation/share/link', {
          profileId,
          message: message || undefined,
          expiresInDays: Number(days) || undefined,
        });
        setLink(data.url);
        setNotice('Link created. Anyone with it can view the biodata until it expires.');
        invalidate();
      } catch (err) {
        setError(apiMessage(err));
      }
    }
  }

  const mayCirculate = consentState?.mayCirculate ?? false;
  const live = (shares ?? []).filter((s) => !s.revokedAt);

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Circulate {profileName}</h3>
        <button className="text-sm text-gray-500 hover:underline" onClick={onClose}>
          Close
        </button>
      </div>

      {notice && <p className="mb-3 rounded bg-brand-light p-2 text-sm text-brand-dark">{notice}</p>}
      {error && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      {!mayCirculate ? (
        <form onSubmit={recordCirculationConsent} className="space-y-3">
          <div className="rounded bg-amber-50 p-3 text-sm text-amber-900">
            {consentState?.needsReconfirmation
              ? 'Permission to circulate this profile has lapsed. Ring the family, then record it again below.'
              : (consentState?.reason ??
                'This profile has no circulation consent yet, so nothing can leave the agency.')}
          </div>
          <ConsentFields value={consent} onChange={setConsent} showCirculation={false} />
          <button className="btn" disabled={recording}>
            {recording ? 'Saving...' : 'Record circulation consent'}
          </button>
        </form>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {(
              [
                ['agent', 'To an agent'],
                ['user', 'To a user'],
                ['link', 'Biodata link'],
                ['pool', 'Network pool'],
              ] as [Mode, string][]
            ).map(([m, label]) => (
              <button
                key={m}
                className={mode === m ? 'btn' : 'btn-outline'}
                onClick={() => {
                  setMode(m);
                  setLink('');
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'pool' ? (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                {pooled
                  ? 'This profile is in the network pool: every approved agency can find it.'
                  : 'Put this profile into the network pool so every approved agency can find it. You can take it out again at any time.'}
              </p>
              <button
                className={pooled ? 'btn-outline' : 'btn'}
                onClick={() =>
                  run(
                    () =>
                      api.put(`/circulation/profiles/${profileId}/pool`, {
                        visibility: pooled ? 'private' : 'pool',
                      }),
                    pooled ? 'Taken out of the pool.' : 'Added to the network pool.',
                  )
                }
              >
                {pooled ? 'Remove from pool' : 'Add to pool'}
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              {mode === 'agent' && (
                <>
                  <div>
                    <label className="label">Find an agency</label>
                    <input
                      className="input"
                      placeholder="Name or city"
                      value={agentSearch}
                      onChange={(e) => setAgentSearch(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Send to</label>
                    <select
                      className="input"
                      value={agentUserId}
                      onChange={(e) => setAgentUserId(e.target.value)}
                      required
                    >
                      <option value="">Select an agency...</option>
                      {((agents?.data ?? []) as AgentEntry[]).map((a) => (
                        <option key={a.userId} value={a.userId}>
                          {a.agencyName}
                          {a.city ? ` — ${a.city}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {mode === 'user' && (
                <div>
                  <label className="label">Account id</label>
                  <input
                    className="input"
                    placeholder="User id of the family's account"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    required
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    For a family that already signed up and is looking themselves.
                  </p>
                </div>
              )}

              {mode === 'link' && (
                <div>
                  <label className="label">Link expires after</label>
                  <select className="input max-w-[10rem]" value={days} onChange={(e) => setDays(e.target.value)}>
                    {['7', '30', '90', '180'].map((d) => (
                      <option key={d} value={d}>
                        {d} days
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="label">
                  Covering note <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input
                  className="input"
                  maxLength={1000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Looking for a groom in Hyderabad, 28-32."
                />
              </div>

              <button className="btn">
                {mode === 'link' ? 'Create biodata link' : 'Share'}
              </button>
            </form>
          )}

          {link && (
            <div className="mt-3 rounded bg-white p-3">
              <p className="text-sm font-medium text-gray-700">Biodata link</p>
              <code className="mt-1 block break-all text-xs text-gray-600">{link}</code>
              <button
                className="btn-outline mt-2"
                onClick={() => navigator.clipboard?.writeText(link)}
              >
                Copy link
              </button>
            </div>
          )}
        </>
      )}

      <div className="mt-4">
        <h4 className="text-sm font-medium text-gray-700">
          Who has this profile ({live.length} live)
        </h4>
        <div className="mt-2 divide-y">
          {live.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-2 text-sm">
              <span className="text-gray-600">
                {s.audience === 'link' ? 'Biodata link' : s.audience === 'agent' ? 'Agency' : 'User'}
                {' · '}
                {new Date(s.createdAt).toLocaleDateString()}
                {s.viewCount > 0 ? ` · opened ${s.viewCount}×` : ' · not opened yet'}
              </span>
              <button className="text-sm text-red-600 hover:underline" onClick={() => revoke.mutate(s.id)}>
                Withdraw
              </button>
            </div>
          ))}
          {live.length === 0 && (
            <p className="py-2 text-sm text-gray-400">Not circulated to anyone yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
