import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

interface Destination { id: string; name: string; country?: string; description?: string }
interface Itinerary { id: string; title: string }

export default function Travel() {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [day1, setDay1] = useState('');

  const { data: destinations } = useQuery({ queryKey: ['destinations'], queryFn: async () => (await api.get('/travel/destinations')).data as Destination[] });
  const { data: itineraries } = useQuery({ queryKey: ['itineraries'], queryFn: async () => (await api.get('/travel/itineraries')).data as Itinerary[] });

  async function createItinerary(e: FormEvent) {
    e.preventDefault();
    await api.post('/travel/itineraries', { title, items: day1 ? [{ day: 1, title: day1 }] : [] });
    setTitle(''); setDay1('');
    qc.invalidateQueries({ queryKey: ['itineraries'] });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-brand-dark">Travel and Honeymoon</h1>

      <div className="card">
        <h2 className="mb-2 font-semibold">Destinations</h2>
        {(destinations ?? []).length === 0 && <p className="text-sm text-gray-400">No destinations loaded yet. An administrator can add them.</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(destinations ?? []).map((d) => (
            <div key={d.id} className="rounded border border-gray-200 p-3">
              <p className="font-medium">{d.name}</p>
              <p className="text-xs text-gray-500">{d.country}</p>
              {d.description && <p className="mt-1 text-sm text-gray-600">{d.description}</p>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={createItinerary} className="card space-y-2">
          <h2 className="font-semibold">Build an itinerary</h2>
          <input className="input" placeholder="Title (e.g. Bali honeymoon)" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <input className="input" placeholder="Day 1 plan" value={day1} onChange={(e) => setDay1(e.target.value)} />
          <button className="btn">Save itinerary</button>
        </form>
        <div className="card">
          <h2 className="mb-2 font-semibold">Your itineraries</h2>
          {(itineraries ?? []).map((it) => <p key={it.id} className="text-sm">{it.title}</p>)}
          {!itineraries?.length && <p className="text-sm text-gray-400">None yet.</p>}
        </div>
      </div>
    </div>
  );
}
