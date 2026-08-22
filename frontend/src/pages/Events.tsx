import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { BOOKING_STATUS_LABEL } from '../lib/permissions';
import RsvpDashboard from '../components/RsvpDashboard';

interface WEvent {
  id: string;
  name: string;
  venue?: string;
  eventDate?: string | null;
}

interface Guest {
  id: string;
  name: string;
  /** Email address, where there is one. */
  contact?: string;
  phone?: string | null;
  /** How many people the invitation covers — the family, not the person. */
  partySize?: number | null;
  relation?: string | null;
}

interface EventVendor {
  bookingId: string;
  status: string;
  amount: string;
  providerId: string;
  providerName: string;
  category: string | null;
}

/**
 * The wedding as a series of days.
 *
 * A wedding is not one event — it is the mehendi, the haldi, the ceremony and
 * the reception, each with its own venue, its own guests and its own vendors.
 * Everything here hangs off whichever day is selected, so the couple can look
 * at one of them at a time rather than at a single undifferentiated list.
 */
export default function Events() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const [date, setDate] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestContact, setGuestContact] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestParty, setGuestParty] = useState('');

  const { data: events = [] } = useQuery({
    queryKey: ['events'],
    queryFn: async () => (await api.get('/events')).data as WEvent[],
  });
  const { data: guests = [] } = useQuery({
    queryKey: ['guests'],
    queryFn: async () => (await api.get('/events/guests')).data as Guest[],
  });
  const { data: guestList } = useQuery({
    queryKey: ['guest-list', selected],
    queryFn: async () => (await api.get(`/events/${selected}/guest-list`)).data,
    enabled: Boolean(selected),
  });
  const { data: vendors = [] } = useQuery<EventVendor[]>({
    queryKey: ['event-vendors', selected],
    queryFn: async () => (await api.get(`/events/${selected}/vendors`)).data,
    enabled: Boolean(selected),
  });

  async function act(fn: () => Promise<unknown>, keys: string[]) {
    setError('');
    try {
      await fn();
      for (const key of keys) qc.invalidateQueries({ queryKey: [key] });
    } catch (err) {
      setError(apiMessage(err, 'That did not work.'));
    }
  }

  async function createEvent(e: FormEvent) {
    e.preventDefault();
    await act(
      () =>
        api.post('/events', {
          name,
          venue: venue || undefined,
          eventDate: date || undefined,
        }),
      ['events'],
    );
    setName('');
    setVenue('');
    setDate('');
  }

  async function addGuest(e: FormEvent) {
    e.preventDefault();
    await act(
      () =>
        api.post('/events/guests', {
          name: guestName,
          contact: guestContact || undefined,
          phone: guestPhone || undefined,
          partySize: guestParty ? Number(guestParty) : undefined,
        }),
      ['guests'],
    );
    setGuestName('');
    setGuestContact('');
    setGuestPhone('');
    setGuestParty('');
  }

  const current = events.find((e) => e.id === selected);
  const invitedIds: string[] =
    guestList?.invites?.map((i: { guestId: string }) => i.guestId) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-brand-dark">Events</h1>
        <p className="text-sm text-gray-600">
          Each day of the wedding, with its guests and the vendors booked for it.
        </p>
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <div className="card">
            <h2 className="mb-2 font-semibold text-gray-900">Your days</h2>
            <div className="space-y-1">
              {events.map((ev) => (
                <div key={ev.id}>
                  {editing === ev.id ? (
                    <EditEvent
                      event={ev}
                      onCancel={() => setEditing(null)}
                      onSave={async (body) => {
                        await act(() => api.put(`/events/${ev.id}`, body), ['events']);
                        setEditing(null);
                      }}
                    />
                  ) : (
                    <div
                      className={`flex items-center justify-between rounded px-3 py-2 ${
                        selected === ev.id ? 'bg-brand-light' : 'hover:bg-gray-50'
                      }`}
                    >
                      <button className="flex-1 text-left" onClick={() => setSelected(ev.id)}>
                        <span className="block text-sm font-medium text-gray-900">{ev.name}</span>
                        <span className="block text-xs text-gray-500">
                          {ev.eventDate
                            ? new Date(`${ev.eventDate}T00:00:00`).toLocaleDateString(undefined, {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })
                            : 'Date not set'}
                          {ev.venue ? ` · ${ev.venue}` : ''}
                        </span>
                      </button>
                      <div className="flex gap-1">
                        <button
                          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                          onClick={() => setEditing(ev.id)}
                        >
                          Edit
                        </button>
                        <button
                          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                          onClick={() =>
                            act(() => api.delete(`/events/${ev.id}`), ['events'])
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {events.length === 0 && (
                <p className="text-sm text-gray-400">Nothing planned yet.</p>
              )}
            </div>
          </div>

          <form onSubmit={createEvent} className="card space-y-2">
            <h2 className="font-semibold text-gray-900">Add a day</h2>
            <input
              className="input"
              placeholder="Mehendi"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <input
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <input
              className="input"
              placeholder="Venue"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
            />
            <button className="btn">Add</button>
          </form>
        </div>

        <div className="space-y-4 lg:col-span-2">
          {!current && (
            <p className="card text-sm text-gray-500">
              Pick a day on the left to see its guests and vendors.
            </p>
          )}

          {current && (
            <>
              <div className="card">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold text-gray-900">Vendors for {current.name}</h2>
                  <Link className="btn-outline" to="/vendors">
                    Book someone for this day
                  </Link>
                </div>
                <div className="divide-y">
                  {vendors.map((v) => (
                    <div key={v.bookingId} className="flex items-center justify-between py-2 text-sm">
                      <div>
                        <p className="font-medium text-gray-900">{v.providerName}</p>
                        <p className="text-xs uppercase tracking-wide text-gray-400">
                          {v.category ?? 'Provider'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-gray-700">
                          {Number(v.amount) > 0 ? `₹${Number(v.amount).toLocaleString('en-IN')}` : '—'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {BOOKING_STATUS_LABEL[v.status] ?? v.status}
                        </p>
                      </div>
                    </div>
                  ))}
                  {vendors.length === 0 && (
                    <p className="py-2 text-sm text-gray-400">
                      Nobody booked for this day yet.
                    </p>
                  )}
                </div>
              </div>

              <RsvpDashboard eventId={current.id} />

              <div className="card">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">Guests for {current.name}</h2>
                  {guestList && (
                    <p className="text-sm text-gray-600">
                      {guestList.summary.attending} of {guestList.summary.total} attending
                    </p>
                  )}
                </div>
                <div className="divide-y">
                  {guests.map((g) => (
                    <div key={g.id} className="flex items-center justify-between py-2 text-sm">
                      <span>
                        {g.name}
                        {g.phone ? <span className="text-gray-500"> · {g.phone}</span> : null}
                        {g.contact ? <span className="text-gray-400"> · {g.contact}</span> : null}
                        {g.partySize && g.partySize > 1 ? (
                          <span className="text-gray-400"> · party of {g.partySize}</span>
                        ) : null}
                      </span>
                      {invitedIds.includes(g.id) ? (
                        <span className="text-xs text-gray-400">Invited</span>
                      ) : (
                        <button
                          className="btn-outline"
                          onClick={() =>
                            act(
                              () => api.post(`/events/${current.id}/invite`, { guestId: g.id }),
                              ['guest-list'],
                            )
                          }
                        >
                          Invite
                        </button>
                      )}
                    </div>
                  ))}
                  {guests.length === 0 && (
                    <p className="py-2 text-sm text-gray-400">No guests on your list yet.</p>
                  )}
                </div>

                <form onSubmit={addGuest} className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                  <input
                    className="input flex-1"
                    placeholder="Guest name"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    required
                  />
                  <input
                    className="input flex-1"
                    placeholder="Email"
                    type="email"
                    value={guestContact}
                    onChange={(e) => setGuestContact(e.target.value)}
                  />
                  {/*
                    A separate mobile column, because chasing an RSVP happens by
                    phone and "email or phone" in one box means neither can be
                    dialled or written to reliably.
                  */}
                  <input
                    className="input w-40"
                    placeholder="Mobile"
                    inputMode="tel"
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                  />
                  <input
                    className="input w-28"
                    type="number"
                    min={1}
                    placeholder="Party of"
                    title="How many people this invitation covers"
                    value={guestParty}
                    onChange={(e) => setGuestParty(e.target.value)}
                  />
                  <button className="btn">Add guest</button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EditEvent({
  event,
  onSave,
  onCancel,
}: {
  event: WEvent;
  onSave: (body: Record<string, string | undefined>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(event.name);
  const [date, setDate] = useState(event.eventDate ?? '');
  const [venue, setVenue] = useState(event.venue ?? '');

  return (
    <form
      className="space-y-2 rounded border border-brand/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name, eventDate: date || undefined, venue: venue || undefined });
      }}
    >
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
      <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <input
        className="input"
        placeholder="Venue"
        value={venue}
        onChange={(e) => setVenue(e.target.value)}
      />
      <div className="flex gap-2">
        <button className="btn">Save</button>
        <button type="button" className="btn-outline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
