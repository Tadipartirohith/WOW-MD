import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { Loading } from '../components/ui/Feedback';
import ManagedProfiles from './ManagedProfiles';

interface Client {
  profileId: string;
  profileCode: string;
  /** Null until the client has an account of their own. */
  id: string | null;
  email: string | null;
  role: string | null;
  isActive: boolean;
  displayName: string | null;
  city: string | null;
  profileCompleted: boolean;
  createdAt: string;
  claimStatus: 'self' | 'invited' | 'claimed' | string;
}

const CLAIM_LABEL: Record<string, string> = {
  self: 'Not yet invited',
  invited: 'Invitation sent',
  claimed: 'Claimed by owner',
};

const CLAIM_TONE: Record<string, string> = {
  self: 'bg-gray-100 text-gray-600',
  invited: 'bg-amber-50 text-amber-800',
  claimed: 'bg-emerald-50 text-emerald-800',
};

/**
 * The agent's book of business: every client they manage.
 *
 * It used to list *accounts*, so a profile built at the counter and not yet
 * invited was simply absent — Client Profiles showed four people and this page
 * showed three, with nothing to say where the fourth had gone. Whether a client
 * has signed in is a fact about that client, not a reason to leave them off
 * their own agent's list.
 *
 * Client Profiles used to be a second page, and an agent managing one client
 * moved between the two to see the account and the profile that belongs to it.
 * It is the lower half of this page now (EZ1-I241). Nothing about it was
 * redesigned: the same section, the same actions, the same behaviour, rendered
 * from the same component the standalone page still uses for a family member.
 *
 * An agent still cannot conjure an account. They build a profile below and
 * send an invitation; the account appears only once the subject accepts and
 * sets their own password, so the agent never knows their credentials.
 */
export default function AgentClients() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  // 'all' rather than an empty string: "show me everyone" is a real answer here,
  // not the absence of one, and a deactivated client still needs finding.
  const [status, setStatus] = useState<'all' | 'active' | 'deactivated'>('all');
  /*
   * The rest of the filters (EZ1-I241). Each maps to one real column rather
   * than to a label: claim status is how far the client got towards owning
   * their account, lifecycle is whether the engagement is live, paused or
   * closed, and client type is simply whether an account exists yet.
   */
  const [claim, setClaim] = useState<'all' | 'self' | 'invited' | 'claimed'>('all');
  const [lifecycle, setLifecycle] = useState<'all' | 'active' | 'deactivated' | 'archived'>('all');
  const [clientType, setClientType] = useState<'all' | 'account' | 'profile'>('all');
  const [city, setCity] = useState('');
  const [error, setError] = useState('');

  const anyFilter =
    Boolean(search) ||
    status !== 'all' ||
    claim !== 'all' ||
    lifecycle !== 'all' ||
    clientType !== 'all' ||
    Boolean(city);

  const { data, isLoading } = useQuery({
    queryKey: ['agent-clients', search, status, claim, lifecycle, clientType, city],
    queryFn: async () =>
      (
        await api.get('/agents/clients', {
          params: {
            ...(search ? { q: search } : {}),
            ...(status === 'all' ? {} : { isActive: status === 'active' }),
            ...(claim === 'all' ? {} : { claimStatus: claim }),
            ...(lifecycle === 'all' ? {} : { lifecycle }),
            ...(clientType === 'all' ? {} : { hasAccount: clientType === 'account' }),
            ...(city ? { city } : {}),
          },
        })
      ).data,
  });

  // The places this agency actually works in, rather than a fixed list that
  // goes stale the first time they take somebody on somewhere new.
  const { data: cityOptions } = useQuery({
    queryKey: ['agent-client-cities'],
    queryFn: async () =>
      (await api.get('/agents/clients/filters/cities')).data as { cities: string[] },
    retry: false,
  });

  const toggle = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) =>
      (await api.put(`/agents/clients/${id}/status`, { isActive })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-clients'] }),
    onError: (err) => setError(apiMessage(err)),
  });

  const clients: Client[] = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">My Clients</h1>
        <p className="page-subtitle">
          Everyone you manage, invited or not, and the profiles you built for them.
        </p>
      </div>

      {error && <p className="alert-critical">{error}</p>}

      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="section-title">Client accounts</h2>
          <div className="flex flex-wrap items-center gap-2">
            {anyFilter && (
              <button
                className="btn-outline text-xs"
                onClick={() => {
                  setSearch('');
                  setStatus('all');
                  setClaim('all');
                  setLifecycle('all');
                  setClientType('all');
                  setCity('');
                }}
              >
                Clear filters
              </button>
            )}
            <input
              className="input max-w-xs"
              placeholder="Search name, email, phone or client ID"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

      {/*
        A row of narrowings rather than one status list, because they answer
        different questions and an agent routinely asks two at once -- "invited
        but not claimed, in Hyderabad" (EZ1-I241). They combine.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input max-w-[11rem]"
          aria-label="Account status"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="all">Any account status</option>
          {/*
            Both of these are questions about an account, so they narrow to
            clients who have one.
          */}
          <option value="active">With an active account</option>
          <option value="deactivated">Deactivated accounts</option>
        </select>
        <select
          className="input max-w-[11rem]"
          aria-label="Invitation status"
          value={claim}
          onChange={(e) => setClaim(e.target.value as typeof claim)}
        >
          <option value="all">Any invitation</option>
          <option value="self">Not yet invited</option>
          <option value="invited">Invitation sent</option>
          <option value="claimed">Claimed by owner</option>
        </select>
        <select
          className="input max-w-[11rem]"
          aria-label="Profile status"
          value={lifecycle}
          onChange={(e) => setLifecycle(e.target.value as typeof lifecycle)}
        >
          <option value="all">Any profile status</option>
          <option value="active">Active</option>
          <option value="deactivated">Paused</option>
          {/* Closed profiles are kept for the record and hidden until asked for. */}
          <option value="archived">Closed</option>
        </select>
        <select
          className="input max-w-[11rem]"
          aria-label="Client type"
          value={clientType}
          onChange={(e) => setClientType(e.target.value as typeof clientType)}
        >
          <option value="all">Any client type</option>
          <option value="account">Has their own account</option>
          <option value="profile">Profile you manage</option>
        </select>
        <select
          className="input max-w-[11rem]"
          aria-label="Location"
          value={city}
          onChange={(e) => setCity(e.target.value)}
        >
          <option value="">All locations</option>
          {(cityOptions?.cities ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

        {isLoading && <Loading rows={3} />}
        {!isLoading && clients.length === 0 && (
          <p className="text-sm text-gray-400">
            {anyFilter
              ? 'No clients match those filters.'
              : 'No clients yet. Build one below.'}
          </p>
        )}

        <div className="divide-y">
          {clients.map((c) => (
            <div
              key={c.profileId}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {c.displayName ?? c.email ?? 'Unnamed client'}{' '}
                  <span className="font-mono text-xs text-gray-400">{c.profileCode}</span>
                </p>
                <p className="text-sm text-gray-500">
                  {[c.email, c.city, c.profileCompleted ? null : 'profile incomplete']
                    .filter(Boolean)
                    .join(' \u00b7 ') || 'No account yet'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    CLAIM_TONE[c.claimStatus] ?? 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {CLAIM_LABEL[c.claimStatus] ?? c.claimStatus}
                </span>
                {/*
                  Only where there is an account to deactivate. Offering the
                  button against a profile nobody has claimed is offering an
                  action with nothing behind it.
                */}
                {c.id && (
                  <>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        c.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {c.isActive ? 'Active' : 'Deactivated'}
                    </span>
                    <button
                      className="btn-outline text-xs"
                      onClick={() =>
                        toggle.mutate({ id: c.id as string, isActive: !c.isActive })
                      }
                    >
                      {c.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </>
                )}
                {/*
                  Open this client's own biodata, not the generic client list —
                  the button carries the profile id so it lands on the right
                  person's complete bio-data (EZ1-I64).
                */}
                <Link className="btn-outline text-xs" to={`/biodata?profileId=${c.profileId}`}>
                  Open profile
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/*
        Client Profiles, in the place it used to link to (EZ1-I241).

        Rendered from the page component itself rather than reimplemented, so
        the create form, the sign-up link and every action on "Profiles you
        manage" are the same code they always were. `embedded` only tells it
        that this page has already written the heading.
      */}
      <ManagedProfiles embedded />
    </div>
  );
}
