import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { api } from '../lib/api';

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

const emptyForm = {
  displayName: '',
  email: '',
  password: '',
  role: 'bride',
  city: '',
};

/**
 * The agent's book of business. Every client created here is stamped with the
 * agent's id server-side, which is what scopes this list and every
 * act-on-behalf-of call the agent later makes.
 */
export default function AgentClients() {
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['agent-clients', search],
    queryFn: async () =>
      (await api.get('/agents/clients', { params: search ? { q: search } : {} })).data,
  });

  const create = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        displayName: form.displayName,
        email: form.email,
        password: form.password,
        role: form.role,
      };
      if (form.city) payload.city = form.city;
      return (await api.post('/agents/clients', payload)).data;
    },
    onSuccess: () => {
      setForm(emptyForm);
      setError('');
      qc.invalidateQueries({ queryKey: ['agent-clients'] });
    },
    onError: (err) => {
      const msg = (err as AxiosError<{ message?: string | string[] }>).response?.data?.message;
      setError(Array.isArray(msg) ? msg.join('. ') : msg || 'Could not create the client.');
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) =>
      (await api.put(`/agents/clients/${id}/status`, { isActive })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-clients'] }),
  });

  const clients: Client[] = data?.data ?? [];

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  const set = (k: keyof typeof emptyForm) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">My Clients</h1>
        <p className="text-sm text-gray-500">
          Accounts you onboard are linked to your agency. You can browse matches, send interests and
          place bookings on their behalf.
        </p>
      </div>

      <form onSubmit={submit} className="card space-y-4">
        <h2 className="font-semibold text-gray-900">Onboard a new client</h2>
        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-600">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="label">Full name</label>
            <input className="input" value={form.displayName} onChange={set('displayName')} required />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={set('email')} required />
          </div>
          <div>
            <label className="label">Temporary password</label>
            <input
              className="input"
              type="password"
              minLength={8}
              value={form.password}
              onChange={set('password')}
              required
            />
          </div>
          <div>
            <label className="label">Profile for</label>
            <select className="input" value={form.role} onChange={set('role')}>
              <option value="bride">Bride</option>
              <option value="groom">Groom</option>
              <option value="family">Family member</option>
            </select>
          </div>
          <div>
            <label className="label">City</label>
            <input className="input" value={form.city} onChange={set('city')} />
          </div>
        </div>
        <p className="text-xs text-gray-500">
          The client signs in with these credentials and can change them. Share the password with
          them directly.
        </p>
        <button className="btn" disabled={create.isPending}>
          {create.isPending ? 'Creating...' : 'Create client'}
        </button>
      </form>

      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-gray-900">Client list</h2>
          <input
            className="input max-w-xs"
            placeholder="Search name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isLoading && <p className="text-sm text-gray-500">Loading...</p>}
        {!isLoading && clients.length === 0 && (
          <p className="text-sm text-gray-400">No clients yet.</p>
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
