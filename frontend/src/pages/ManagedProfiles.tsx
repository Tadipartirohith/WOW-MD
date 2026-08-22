import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import {
  CLAIM_STATUS_LABEL,
  LIFECYCLE_LABEL,
  Permission,
  ProfileClaimStatus,
  ProfileLifecycle,
  can,
} from '../lib/permissions';
import ConsentFields, { ConsentDraft, consentPayload, emptyConsent } from '../components/ConsentFields';
import ShareProfileDialog from '../components/ShareProfileDialog';
import PhotoUploader from '../components/PhotoUploader';

interface ManagedProfile {
  id: string;
  displayName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  networkVisibility: 'private' | 'pool';
  gender: string | null;
  dateOfBirth: string | null;
  city: string | null;
  bio: string | null;
  photos: string[];
  claimStatus: ProfileClaimStatus;
  profileCompleted: boolean;
  createdAt: string;
  lifecycle?: ProfileLifecycle;
  lifecycleReason?: string | null;
  /**
   * Whether this profile may actually be circulated, and why not when it may
   * not. Decided at intake by a checkbox on the creation form, and changeable
   * afterwards — families change their minds, and a decision taken at the desk
   * on day one should not be permanent.
   */
  circulation?: {
    intake: boolean;
    circulation: boolean;
    mayCirculate: boolean;
    needsReconfirmation: boolean;
    reason: string | null;
  } | null;
  /**
   * What the agency may still do to this row, decided by the server. Rendering
   * from this rather than re-deriving it here keeps the buttons and the rules
   * from drifting apart.
   */
  actions?: {
    canEdit: boolean;
    canManagePhotos: boolean;
    canCirculate: boolean;
    canInvite: boolean;
    canPause: boolean;
    canClose: boolean;
    canDelete: boolean;
  };
}

interface AgencyStatus {
  registered: boolean;
  approved: boolean;
  rejectionReason: string | null;
  agencyName: string | null;
}

const emptyDraft = {
  displayName: '',
  contactPhone: '',
  contactEmail: '',
  gender: 'female',
  dateOfBirth: '',
  city: '',
  bio: '',
};

/**
 * Where an agent (or a family member looking after a relative) builds a full
 * profile for somebody who has not signed up.
 *
 * The profile is matchable straight away. An invitation is a separate,
 * deliberate step: it emails the subject a link where THEY choose a password,
 * which is why the steward never sets one here.
 */
export default function ManagedProfiles() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isAgent = can(permissions, Permission.AGENCY_MANAGE);

  const [draft, setDraft] = useState(emptyDraft);
  const [consent, setConsent] = useState<ConsentDraft>(emptyConsent());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [enabling, setEnabling] = useState<string | null>(null);
  const [reach, setReach] = useState<string | null>(null);

  const { data: agency } = useQuery({
    queryKey: ['agency-status'],
    queryFn: async () => (await api.get('/agents/agency/status')).data as AgencyStatus,
    retry: false,
    enabled: isAgent,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['managed-profiles'],
    queryFn: async () => (await api.get('/agents/profiles')).data,
  });

  const create = useMutation({
    mutationFn: async (inviteNow: boolean) => {
      const payload: Record<string, unknown> = {
        displayName: draft.displayName,
        contactPhone: draft.contactPhone,
        gender: draft.gender,
        consent: consentPayload(consent),
        inviteNow,
      };
      // Email is optional: a walk-in family often gives only a number.
      if (draft.contactEmail) payload.contactEmail = draft.contactEmail;
      if (draft.dateOfBirth) payload.dateOfBirth = draft.dateOfBirth;
      if (draft.city) payload.city = draft.city;
      if (draft.bio) payload.bio = draft.bio;
      return (await api.post('/agents/profiles', payload)).data as ManagedProfile;
    },
    onSuccess: (profile, inviteNow) => {
      setDraft(emptyDraft);
      setConsent(emptyConsent());
      setError('');
      setNotice(
        inviteNow
          ? `Profile created and an invitation emailed to ${profile.contactEmail}.`
          : 'Profile saved. It is matchable now — circulate it, or invite them to claim it later.',
      );
      qc.invalidateQueries({ queryKey: ['managed-profiles'] });
    },
    onError: (err) => {
      setNotice('');
      setError(apiMessage(err, 'Could not create that profile.'));
    },
  });

  const invite = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/agents/profiles/${id}/invite`)).data as { devUrl?: string },
    onSuccess: (res) => {
      setError('');
      setNotice(
        res.devUrl
          ? `Invitation sent. Development link: ${res.devUrl}`
          : 'Invitation emailed. They choose their own password when they accept.',
      );
      qc.invalidateQueries({ queryKey: ['managed-profiles'] });
    },
    onError: (err) => setError(apiMessage(err)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/agents/profiles/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['managed-profiles'] }),
    onError: (err) => setError(apiMessage(err)),
  });

  /**
   * Pausing and closing, as distinct from deleting.
   *
   * A client who steps back for a few months has not ended the engagement, and
   * a client who married elsewhere has — but neither should lose the consent
   * record or the circulation history, so nothing here removes a row.
   */
  const lifecycle = useMutation({
    mutationFn: async ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: 'deactivate' | 'reactivate' | 'archive';
      reason?: string;
    }) => (await api.put(`/agents/profiles/${id}/${action}`, reason ? { reason } : {})).data,
    onSuccess: (_res, vars) => {
      setError('');
      setNotice(
        vars.action === 'deactivate'
          ? 'Paused. It will not be matched or circulated until you bring it back.'
          : vars.action === 'reactivate'
            ? 'Back in matchmaking.'
            : 'Closed. The record stays for the audit trail, and anything held in escrow is refunded.',
      );
      qc.invalidateQueries({ queryKey: ['managed-profiles'] });
    },
    onError: (err) => setError(apiMessage(err)),
  });

  const profiles: ManagedProfile[] = data?.data ?? [];
  const set = (k: keyof typeof emptyDraft) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(false);
  }

  // An agent has to be vetted before any of this works, so say so plainly
  // rather than letting every action fail with a 403.
  if (isAgent && agency && !agency.approved) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-brand-dark">Client Profiles</h1>
        <div className="card border-amber-200 bg-amber-50">
          <h2 className="font-semibold text-amber-900">
            {agency.registered ? 'Your agency is awaiting approval' : 'Register your agency first'}
          </h2>
          <p className="mt-2 text-sm text-amber-900">
            {agency.registered
              ? 'An administrator reviews every agency before it can build profiles or invite clients. You will be emailed when yours is reviewed.'
              : 'Before you can build client profiles, tell us who you are. An administrator reviews each agency.'}
          </p>
          {agency.rejectionReason && (
            <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700">
              Not approved: {agency.rejectionReason}
            </p>
          )}
          <a href="/agency" className="btn mt-3">
            {agency.registered ? 'Review agency details' : 'Register agency'}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Client Profiles</h1>
        <p className="text-sm text-gray-500">
          Build a complete profile for someone who has not joined yet. It can be matched
          immediately; when you invite them, they set their own password and take ownership.
        </p>
      </div>

      {notice && <p className="rounded bg-brand-light p-3 text-sm text-brand-dark">{notice}</p>}
      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <form onSubmit={submit} className="card space-y-4">
        <h2 className="font-semibold text-gray-900">New profile</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">Full name</label>
            <input className="input" value={draft.displayName} onChange={set('displayName')} required />
          </div>
          <div>
            <label className="label">Mobile number</label>
            <input
              className="input"
              placeholder="+919876543210"
              value={draft.contactPhone}
              onChange={set('contactPhone')}
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              International format. This is how you reach the family.
            </p>
          </div>
          <div>
            <label className="label">
              Email <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              className="input"
              type="email"
              value={draft.contactEmail}
              onChange={set('contactEmail')}
            />
            <p className="mt-1 text-xs text-gray-500">
              Only needed if you want to invite them to manage it themselves.
            </p>
          </div>
          <div>
            <label className="label">Gender</label>
            <select className="input" value={draft.gender} onChange={set('gender')}>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>
          <div>
            <label className="label">Date of birth</label>
            <input
              className="input"
              type="date"
              value={draft.dateOfBirth}
              onChange={set('dateOfBirth')}
            />
          </div>
          <div>
            <label className="label">City</label>
            <input className="input" value={draft.city} onChange={set('city')} />
          </div>
        </div>
        <div>
          <label className="label">About them</label>
          <textarea className="input" rows={3} maxLength={2000} value={draft.bio} onChange={set('bio')} />
        </div>

        <ConsentFields value={consent} onChange={setConsent} />

        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={create.isPending}>
            {create.isPending ? 'Saving...' : 'Save profile'}
          </button>
          <button
            type="button"
            className="btn-outline"
            disabled={create.isPending || !draft.contactEmail}
            title={draft.contactEmail ? undefined : 'An email address is needed to send an invitation'}
            onClick={() => create.mutate(true)}
          >
            Save and invite now
          </button>
        </div>
      </form>

      <div className="card space-y-3">
        <h2 className="font-semibold text-gray-900">Profiles you manage</h2>
        {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
        {!isLoading && profiles.length === 0 && (
          <p className="text-sm text-gray-400">You have not built any profiles yet.</p>
        )}

        <div className="divide-y">
          {profiles.map((p) => (
            <div key={p.id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {p.displayName}
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                        p.claimStatus === 'claimed'
                          ? 'bg-green-50 text-green-700'
                          : p.claimStatus === 'invited'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {CLAIM_STATUS_LABEL[p.claimStatus]}
                    </span>
                  </p>
                  <p className="text-sm text-gray-500">
                    {p.contactPhone}
                    {p.contactEmail ? ` · ${p.contactEmail}` : ' · no email on file'}
                    {p.city ? ` · ${p.city}` : ''}
                    {` · ${p.photos?.length ?? 0} photo(s)`}
                    {p.networkVisibility === 'pool' ? ' · in network pool' : ''}
                  </p>
                  {p.lifecycle && p.lifecycle !== 'active' && (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      {LIFECYCLE_LABEL[p.lifecycle]}
                      {p.lifecycleReason ? ` — ${p.lifecycleReason}` : ''}
                    </p>
                  )}
                  {p.claimStatus === 'claimed' && (
                    <p className="mt-1 text-xs text-gray-500">
                      This profile belongs to its owner now, so it is read-only for you.
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const allow = p.actions;
                    return (
                    <>
                      {allow?.canManagePhotos && (
                      <button
                        className="btn-outline"
                        onClick={() => setSelected(selected === p.id ? null : p.id)}
                      >
                        {selected === p.id ? 'Close' : 'Photos'}
                      </button>
                      )}
                      {allow?.canCirculate && (
                        <button
                          className="btn-outline"
                          onClick={() => setReach(reach === p.id ? null : p.id)}
                        >
                          {reach === p.id ? 'Hide reach' : 'Reach'}
                        </button>
                      )}
                      {/*
                        Circulation is off until somebody says otherwise, and
                        the button says which state it is in. A Circulate button
                        that opens a dialog only to refuse is how an agent loses
                        confidence in the whole screen.
                      */}
                      {can(permissions, Permission.PROFILE_CIRCULATE) &&
                        allow?.canCirculate &&
                        (p.circulation && !p.circulation.mayCirculate ? (
                          <button
                            className="btn-outline"
                            title={p.circulation.reason ?? undefined}
                            onClick={() => setEnabling(enabling === p.id ? null : p.id)}
                          >
                            {enabling === p.id
                              ? 'Cancel'
                              : p.circulation.needsReconfirmation
                                ? 'Re-confirm circulation'
                                : 'Enable circulation'}
                          </button>
                        ) : (
                          <button
                            className="btn"
                            onClick={() => setSharing(sharing === p.id ? null : p.id)}
                          >
                            {sharing === p.id ? 'Done' : 'Circulate'}
                          </button>
                        ))}
                      {can(permissions, Permission.MANAGED_PROFILE_INVITE) && allow?.canInvite && (
                        <button className="btn-outline" onClick={() => invite.mutate(p.id)}>
                          {p.claimStatus === 'invited' ? 'Resend invite' : 'Send invite'}
                        </button>
                      )}
                      {allow?.canPause && p.lifecycle === 'deactivated' ? (
                        <button
                          className="btn-outline"
                          onClick={() => lifecycle.mutate({ id: p.id, action: 'reactivate' })}
                        >
                          Resume
                        </button>
                      ) : (
                        allow?.canPause && (
                          <button
                            className="btn-outline"
                            onClick={() =>
                              lifecycle.mutate({
                                id: p.id,
                                action: 'deactivate',
                                reason:
                                  window.prompt('Why are they pausing? (optional)') || undefined,
                              })
                            }
                          >
                            Pause
                          </button>
                        )
                      )}
                      {allow?.canClose && (
                        <button
                          className="btn-outline"
                          onClick={() => {
                            const reason = window.prompt(
                              'Closing the engagement. Why? (optional)',
                            );
                            if (reason !== null) {
                              lifecycle.mutate({
                                id: p.id,
                                action: 'archive',
                                reason: reason || undefined,
                              });
                            }
                          }}
                        >
                          Close
                        </button>
                      )}
                      {allow?.canDelete && (
                        <button className="btn-outline" onClick={() => remove.mutate(p.id)}>
                          Delete
                        </button>
                      )}
                    </>
                    );
                  })()}
                </div>
              </div>

              {selected === p.id && <PhotoEditor profile={p} onError={setError} />}
              {reach === p.id && <ReachPanel profileId={p.id} />}

              {sharing === p.id && (
                <ShareProfileDialog
                  profileId={p.id}
                  profileName={p.displayName}
                  pooled={p.networkVisibility === 'pool'}
                  onClose={() => setSharing(null)}
                />
              )}

              {enabling === p.id && (
                <EnableCirculation
                  profileId={p.id}
                  profileName={p.displayName}
                  needsReconfirmation={p.circulation?.needsReconfirmation ?? false}
                  onDone={() => {
                    setEnabling(null);
                    void qc.invalidateQueries({ queryKey: ['managed-profiles'] });
                    void qc.invalidateQueries({ queryKey: ['consent', p.id] });
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PhotoEditor({
  profile,
  onError,
}: {
  profile: ManagedProfile;
  onError: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post(`/agents/profiles/${profile.id}/photos`, { url });
      setUrl('');
      qc.invalidateQueries({ queryKey: ['managed-profiles'] });
    } catch (err) {
      onError(apiMessage(err, 'That photo could not be added.'));
    }
  }

  async function drop(photo: string) {
    try {
      await api.delete(`/agents/profiles/${profile.id}/photos`, { data: { url: photo } });
      qc.invalidateQueries({ queryKey: ['managed-profiles'] });
    } catch (err) {
      onError(apiMessage(err));
    }
  }

  return (
    <div className="mt-3 rounded-lg bg-gray-50 p-3">
      <div className="flex flex-wrap gap-3">
        {(profile.photos ?? []).map((photo) => (
          <div key={photo} className="relative">
            <img
              src={photo}
              alt=""
              className="h-24 w-24 rounded object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.opacity = '0.3';
              }}
            />
            <button
              className="absolute right-1 top-1 rounded bg-white/90 px-1.5 text-xs"
              onClick={() => drop(photo)}
              aria-label="Remove photo"
            >
              &times;
            </button>
          </div>
        ))}
        {(profile.photos ?? []).length === 0 && (
          <p className="text-sm text-gray-500">No photos yet.</p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <PhotoUploader
          label="Upload a photo"
          onUploaded={async (uploaded) => {
            try {
              await api.post(`/agents/profiles/${profile.id}/photos`, { url: uploaded });
              qc.invalidateQueries({ queryKey: ['managed-profiles'] });
            } catch (err) {
              onError(apiMessage(err, 'That photo could not be added.'));
            }
          }}
        />
        <span className="text-sm text-gray-400">or</span>
        <form onSubmit={add} className="flex flex-1 flex-wrap items-end gap-2">
          <input
            className="input flex-1"
            placeholder="https://… paste an address"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <button className="btn-outline">Add</button>
        </form>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Up to 20 photos. Uploading is usually easier — the file goes straight from this device to
        storage without passing through us.
      </p>
    </div>
  );
}

/**
 * Did circulating this profile lead anywhere?
 *
 * An agency could already see who held a profile and whether a link had been
 * opened, but not whether any of it produced anything — which is the only
 * question they actually have. "Opened and then silence" is the number worth
 * acting on: it means the biodata is being read and passed over, which is a
 * different problem from nobody looking at it.
 */
function ReachPanel({ profileId }: { profileId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reach', profileId],
    queryFn: async () => (await api.get(`/circulation/profiles/${profileId}/reach`)).data,
    retry: false,
  });

  if (isLoading) return <p className="py-2 text-sm text-gray-400">Loading…</p>;
  if (!data) return null;

  return (
    <div className="mt-2 rounded bg-gray-50 p-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Shared with" value={data.live} note={`${data.revoked} withdrawn`} />
        <Metric label="Opened" value={data.opened} note={`${data.totalViews} views`} />
        <Metric label="Interests" value={data.interests} note={`${data.accepted} accepted`} />
        <Metric
          label="Read, then nothing"
          value={data.openedButSilent}
          note="Worth a follow-up call"
        />
      </div>
      {data.live === 0 && (
        <p className="mt-2 text-sm text-gray-600">
          This profile has not been circulated yet.
        </p>
      )}
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className="text-xl font-semibold text-gray-900"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </p>
      <p className="text-xs text-gray-500">{note}</p>
    </div>
  );
}

/**
 * Turning circulation on after the fact.
 *
 * The checkbox on the intake form decides this on day one, and until now that
 * was the only chance anybody got: a family who said "not yet" at the desk and
 * changed their mind a month later had no way through. Consent is append-only,
 * so this records a fresh one rather than editing the old — which is also the
 * honest thing, because it *is* a fresh conversation with the family.
 *
 * The confirmation is not ceremony. Circulating a biodata puts somebody's
 * photograph and horoscope in front of strangers, and an agent should have to
 * say out loud who agreed to that.
 */
function EnableCirculation({
  profileId,
  profileName,
  needsReconfirmation,
  onDone,
}: {
  profileId: string;
  profileName: string;
  needsReconfirmation: boolean;
  onDone: () => void;
}) {
  const [consent, setConsent] = useState<ConsentDraft>(emptyConsent());
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post(`/circulation/profiles/${profileId}/consent`, {
        scope: 'circulation',
        ...consentPayload(consent, false),
      });
      onDone();
    } catch (err) {
      setError(apiMessage(err, 'That consent could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded bg-amber-50/60 p-3">
      <div>
        <p className="text-sm font-medium text-gray-900">
          {needsReconfirmation ? 'Re-confirm circulation' : 'Enable circulation'} for {profileName}
        </p>
        <p className="text-sm text-gray-600">
          {needsReconfirmation
            ? 'The earlier consent has lapsed. Ring the family and record the new one.'
            : 'This profile was taken on without permission to share it. Record that permission here.'}
        </p>
      </div>

      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}

      <ConsentFields value={consent} onChange={setConsent} showCirculation={false} />

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span className="text-gray-700">
          I have spoken to the family and they agree to this biodata being shared with other
          agencies and prospective families.
        </span>
      </label>

      <button className="btn" disabled={!confirmed || busy}>
        {busy ? 'Recording…' : 'Record consent'}
      </button>
    </form>
  );
}
