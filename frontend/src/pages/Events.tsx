import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

interface WEvent { id: string; name: string; venue?: string; eventDate?: string }
interface Guest { id: string; name: string; contact?: string }

export default function Events() {
  const qc = useQueryClient();
  const [ename, setEname] = useState('');
  const [venue, setVenue] = useState('');
  const [gname, setGname] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data: events } = useQuery({ queryKey: ['events'], queryFn: async () => (await api.get('/events')).data as WEvent[] });
  const { data: guests } = useQuery({ queryKey: ['guests'], queryFn: async () => (await api.get('/events/guests')).data as Guest[] });
  const { data: guestList } = useQuery({
    queryKey: ['guest-list', selected],
    queryFn: async () => (await api.get(`/events/${selected}/guest-list`)).data,
    enabled: !!selected,
  });

  async function createEvent(e: FormEvent) {
    e.preventDefault();
    await api.post('/events', { name: ename, venue });
    setEname(''); setVenue('');
    qc.invalidateQueries({ queryKey: ['events'] });
  }
  async function addGuest(e: FormEvent) {
    e.preventDefault();
    await api.post('/events/guests', { name: gname });
    setGname('');
    qc.invalidateQueries({ queryKey: ['guests'] });
  }
  async function invite(eventId: string, guestId: string) {
    await api.post(`/events/${eventId}/invite`, { guestId });
    qc.invalidateQueries({ queryKey: ['guest-list', eventId] });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-brand-dark">Events and Guests</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={createEvent} className="card space-y-2">
          <h2 className="font-semibold">Create an event</h2>
          <input className="input" placeholder="Name (e.g. Mehendi)" value={ename} onChange={(e) => setEname(e.target.value)} required />
          <input className="input" placeholder="Venue" value={venue} onChange={(e) => setVenue(e.target.value)} />
          <button className="btn">Add event</button>
        </form>
        <form onSubmit={addGuest} className="card space-y-2">
          <h2 className="font-semibold">Add a guest</h2>
          <input className="input" placeholder="Guest name" value={gname} onChange={(e) => setGname(e.target.value)} required />
          <button className="btn">Add guest</button>
        </form>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-2 font-semibold">Your events</h2>
          {(events ?? []).map((ev) => (
            <button key={ev.id} onClick={() => setSelected(ev.id)} className={`mb-1 block w-full rounded px-3 py-2 text-left text-sm ${selected === ev.id ? 'bg-brand-light' : 'hover:bg-gray-100'}`}>
              {ev.name} {ev.venue ? `at ${ev.venue}` : ''}
            </button>
          ))}
          {!events?.length && <p className="text-sm text-gray-400">No events yet.</p>}
        </div>
        <div className="card">
          <h2 className="mb-2 font-semibold">Invite guests {selected ? '' : '(select an event)'}</h2>
          {selected && (guests ?? []).map((g) => (
            <div key={g.id} className="mb-1 flex items-center justify-between text-sm">
              <span>{g.name}</span>
              <button className="btn-outline" onClick={() => invite(selected, g.id)}>Invite</button>
            </div>
          ))}
          {selected && guestList && (
            <p className="mt-3 text-sm text-gray-600">Attending {guestList.summary.attending} of {guestList.summary.total} invited.</p>
          )}
        </div>
      </div>
    </div>
  );
}
