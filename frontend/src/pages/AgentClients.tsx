import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';

interface Client {
  id: string;
  email: string;
  role: string;
  isActive: boolean;
  displayName: string | null;
  city: string | null;
  profileCompleted: boolean;
  createdAt: string;
}

/**
 * The agent's book of business: accounts that exist because someone accepted
 * their invitation.
 *
 * There is no "create client" form here any more. An agent cannot conjure an
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
          Accounts created when someone accepted your invitation. To onboard a new person, build
          their profile under{' '}
          <Link className="text-brand" to="/client-profiles">
            Client Profiles
          </Link>{' '}
          and send an invite.
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
              <option value="active">Active</option>
              <option value="deactivated">Deactivated</option>
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
              : 'No clients have accepted an invitation yet.'}
          </p>
        )}

        <div className="divide-y">
          {clients.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-medium">
                  {c.displayName ?? c.email}{' '}
                  <span className="text-xs uppercase tracking-wide text-gray-400">{c.role}</span>
                </p>
                <p className="text-sm text-gray-500">
                  {c.email}
                  {c.city ? ` · ${c.city}` : ''}
                  {c.profileCompleted ? '' : ' · profile incomplete'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    c.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {c.isActive ? 'Active' : 'Deactivated'}
                </span>
                <button
                  className="btn-outline"
                  onClick={() => toggle.mutate({ id: c.id, isActive: !c.isActive })}
                >
                  {c.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
