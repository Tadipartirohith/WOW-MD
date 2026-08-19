import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ProfileClaimStatus } from '../lib/permissions';

export interface ActableProfile {
  id: string;
  displayName: string;
  userId: string | null;
  claimStatus: ProfileClaimStatus;
  city: string | null;
}

/**
 * Picks which profile an action runs under.
 *
 * Stewards (agents, family members) act for people who may not have an account
 * yet, so the selector lists profiles rather than users. The server re-verifies
 * that the chosen profile is one the caller owns or manages, so a tampered
 * value here buys nothing.
 */
export default function ProfileSelector({
  value,
  onChange,
  label = 'Acting as',
  includeOwn = true,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  includeOwn?: boolean;
}) {
  const { data } = useQuery({
    queryKey: ['actable-profiles'],
    queryFn: async () => (await api.get('/agents/profiles/actable')).data as ActableProfile[],
    retry: false,
  });

  const profiles = (data ?? []).filter((p) => includeOwn || p.userId === null || p.claimStatus !== 'self');

  return (
    <div>
      <label className="label">{label}</label>
      <select className="input max-w-xs" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select a profile...</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
            {p.claimStatus === 'self' ? ' (me)' : ''}
            {p.claimStatus === 'unclaimed' ? ' — not yet invited' : ''}
            {p.claimStatus === 'invited' ? ' — invite sent' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
