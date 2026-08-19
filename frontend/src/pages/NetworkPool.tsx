import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import ProfileSelector from '../components/ProfileSelector';

interface PoolProfile {
  id: string;
  displayName: string;
  gender: string | null;
  city: string | null;
  bio: string | null;
  photos: string[];
  dateOfBirth: string | null;
}

/**
 * Profiles other agencies have put into the shared network.
 *
 * This is the digital version of the phone call around the local agents: your
 * bride, my groom. Only approved agencies can see it, and only profiles whose
 * families agreed to circulation ever appear.
 */
export default function NetworkPool() {
  const [city, setCity] = useState('');
  const [gender, setGender] = useState('');
  const [q, setQ] = useState('');
  const [actingProfileId, setActingProfileId] = useState('');
  const [message, setMessage] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['pool', city, gender, q],
    queryFn: async () =>
      (
        await api.get('/circulation/pool', {
          params: {
            ...(city ? { city } : {}),
            ...(gender ? { gender } : {}),
            ...(q ? { q } : {}),
          },
        })
      ).data,
    retry: false,
  });

  async function propose(toProfileId: string) {
    setMessage('');
    if (!actingProfileId) {
      setMessage('Pick which of your clients you are proposing first.');
      return;
    }
    try {
      await api.post('/matches/interest', { toProfileId, profileId: actingProfileId });
      setMessage('Proposed. Open Proposals to talk it through with the other agent.');
    } catch (err) {
      setMessage(apiMessage(err, 'That proposal was not accepted.'));
    }
  }

  const profiles: PoolProfile[] = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Network Pool</h1>
        <p className="text-sm text-gray-500">
          Profiles other approved agencies have opened up to the network. Pick one of your own
          clients, then propose a pairing.
        </p>
      </div>

      {message && <p className="rounded bg-brand-light p-3 text-sm text-brand-dark">{message}</p>}

      <div className="card flex flex-wrap items-end gap-3">
        <ProfileSelector
          value={actingProfileId}
          onChange={setActingProfileId}
          label="Proposing for"
        />
        <div>
          <label className="label">Looking for</label>
          <select className="input max-w-[10rem]" value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">Anyone</option>
            <option value="female">Bride</option>
            <option value="male">Groom</option>
          </select>
        </div>
        <div>
          <label className="label">City</label>
          <input className="input max-w-xs" value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="flex-1">
          <label className="label">Search</label>
          <input
            className="input"
            placeholder="Name or description"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {isLoading && <p className="text-gray-500">Loading...</p>}
      {!isLoading && profiles.length === 0 && (
        <p className="card text-sm text-gray-500">
          Nothing in the pool matches that search yet.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profiles.map((p) => (
          <div key={p.id} className="card flex flex-col">
            <h2 className="font-semibold">{p.displayName}</h2>
            <p className="text-sm text-gray-500">
              {[p.gender, p.city].filter(Boolean).join(' · ')}
            </p>
            {p.photos?.[0] ? (
              <img src={p.photos[0]} alt="" className="mt-2 h-40 w-full rounded object-cover" />
            ) : (
              <div className="mt-2 flex h-40 items-center justify-center rounded bg-gray-50 text-xs text-gray-400">
                No photo
              </div>
            )}
            {p.bio && <p className="mt-2 flex-1 text-sm text-gray-600">{p.bio}</p>}
            <button className="btn mt-3" onClick={() => propose(p.id)}>
              Propose a match
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
