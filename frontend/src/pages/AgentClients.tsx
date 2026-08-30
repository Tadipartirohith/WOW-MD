import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';

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
 * There is still no "create client" form here. An agent cannot conjure an
 * account: they build a profile under Client Profiles and send an invitation,
 * and the account only appears once the subject accepts and sets their own
 * password — so the agent never knows their credentials.
 */
export default function AgentClients() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  // 'all' rather than an empty string: "show me everyone" is a real answer here,
  // not the absence of one, and a deactivated client still needs finding.
  const [status, setStatus] = useState<'all' | 'active' | 'deactivated'>('all');
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['agent-clients', search, status],
    queryFn: async () =>
      (
        await api.get('/agents/clients', {
          params: {
            ...(search ? { q: search } : {}),
            ...(status === 'all' ? {} : { isActive: status === 'active' }),
          },
        })
      ).data,
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
        <h1 className="text-xl font-bold text-brand-dark">My Clients</h1>
        <p className="text-sm text-gray-500">
          Everyone you manage, invited or not. Build a new one under{' '}
          <Link className="text-brand" to="/client-profiles">
            Client Profiles
          </Link>
          .
        </p>
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-900">Client accounts</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input max-w-[10rem]"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="all">All clients</option>
              {/*
                Both of these are questions about an account, so they narrow to
                clients who have one. "All" is the honest default here.
              */}
              <option value="active">With an active account</option>
              <option value="deactivated">Deactivated accounts</option>
            </select>
            <input
              className="input max-w-xs"
              placeholder="Search name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
        {!isLoading && clients.length === 0 && (
          <p className="text-sm text-gray-400">
            {search || status !== 'all'
              ? 'No clients match that filter.'
              : 'No clients yet. Build one under Client Profiles.'}
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
                <Link className="btn-outline text-xs" to="/client-profiles">
                  Open profile
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
