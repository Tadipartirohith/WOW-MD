import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface Client {
  id: string;
  email: string;
  displayName: string | null;
}

/**
 * Agent-only control: picks which client an action runs under. The server
 * re-verifies that the chosen client is on the caller's books, so a tampered
 * value here buys nothing.
 */
export default function ClientSelector({
  value,
  onChange,
  label = 'Acting for',
  allowSelf = true,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  allowSelf?: boolean;
}) {
  const { data } = useQuery({
    queryKey: ['agent-clients', 'selector'],
    queryFn: async () => (await api.get('/agents/clients', { params: { limit: 100 } })).data,
  });

  const clients: Client[] = data?.data ?? [];

  return (
    <div>
      <label className="label">{label}</label>
      <select className="input max-w-xs" value={value} onChange={(e) => onChange(e.target.value)}>
        {allowSelf && <option value="">Myself</option>}
        {!allowSelf && <option value="">Select a client…</option>}
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.displayName ?? c.email}
          </option>
        ))}
      </select>
    </div>
  );
}
