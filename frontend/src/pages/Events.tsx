import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { BOOKING_STATUS_LABEL } from '../lib/permissions';
import RsvpDashboard from '../components/RsvpDashboard';
import { formatDate } from '../lib/dates';

interface WEvent {
  id: string;
  name: string;
  venue?: string;
  eventDate?: string | null;
  eventType?: string | null;
  category?: string | null;
  venueAddress?: string | null;
  city?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  expectedGuests?: number | null;
  budget?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  status?: EventStatus;
  /** Coming / not coming / not yet answered, for this day alone. */
  rsvp?: { coming: number; notComing: number; noReply: number };
}

type EventStatus = 'upcoming' | 'ongoing' | 'completed' | 'cancelled';

const STATUS_LABEL: Record<EventStatus, string> = {
  upcoming: 'Upcoming',
  ongoing: 'Today',
  completed: 'Done',
  cancelled: 'Cancelled',
};

const STATUS_TONE: Record<EventStatus, string> = {
  upcoming: 'bg-sky-50 text-sky-800',
  ongoing: 'bg-emerald-50 text-emerald-800',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-50 text-red-700',
};

const CATEGORY_LABEL: Record<string, string> = {
  main: 'Main event',
  pre_wedding: 'Pre-wedding',
  post_wedding: 'Post-wedding',
};

interface EventSummary {
  total: number;
  upcoming: number;
  ongoing: number;
  completed: number;
  cancelled: number;
  confirmedGuests: number;
  expectedGuests: number;
  budget: string;
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
  const [statusFilter, setStatusFilter] = useState<EventStatus | ''>('');
  /*
   * How the days are shown.
   *
   * A list is right when you know which day you want and are moving between
   * them; cards are right when you are looking at the shape of the whole
   * wedding and want the date, the venue and the numbers at a glance. Neither
   * is better, which is why it is a choice rather than a redesign.
   */
  const [view, setView] = useState<'list' | 'cards'>('list');
  const [search, setSearch] = useState('');
  // The three fields everybody fills in stay visible; the rest are behind a
  // disclosure, because a fourteen-field form for "add the mehendi" is a form
  // people abandon.
  const [more, setMore] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const [date, setDate] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestContact, setGuestContact] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestParty, setGuestParty] = useState('');

  const { data: events = [] } = useQuery({
    queryKey: ['events', statusFilter, search],
    queryFn: async () =>
      (
        await api.get('/events', {
          params: {
            ...(statusFilter ? { status: statusFilter } : {}),
            ...(search ? { q: search } : {}),
          },
        })
      ).data as WEvent[],
  });

  // Counted on the server from the same rows the list below shows, so the two
  // cannot disagree — which is the failure that stops somebody believing a
  // summary at all.
  const { data: summary } = useQuery({
    queryKey: ['event-summary'],
    queryFn: async () => (await api.get('/events/summary')).data as EventSummary,
    retry: false,
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

  // Two head counts, and they are different numbers: invitations are what was
  // sent, people are what turns up.
  const { data: rsvp } = useQuery<{
    invitations: { total: number; attending: number; declined: number; maybe: number; pending: number };
    people: { attending: number };
  }>({
    queryKey: ['event-rsvp', selected],
    queryFn: async () => (await api.get(`/events/${selected}/rsvp`)).data,
    enabled: Boolean(selected),
    retry: false,
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
          eventType: draft.eventType || undefined,
          category: draft.category || undefined,
          venueAddress: draft.venueAddress || undefined,
          city: draft.city || undefined,
          startTime: draft.startTime || undefined,
          endTime: draft.endTime || undefined,
          expectedGuests: draft.expectedGuests ? Number(draft.expectedGuests) : undefined,
          budget: draft.budget || undefined,
          description: draft.description || undefined,
        }),
      ['events', 'event-summary'],
    );
    setName('');
    setVenue('');
    setDate('');
    setDraft({});
    setMore(false);
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

      {summary && summary.total > 0 && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Days" value={summary.total} onClick={() => setStatusFilter('')} />
          <Stat
            label="Upcoming"
            value={summary.upcoming}
            tone="text-sky-700"
            onClick={() => setStatusFilter('upcoming')}
          />
          <Stat
            label="Done"
            value={summary.completed}
            onClick={() => setStatusFilter('completed')}
          />
          <Stat
            label="Cancelled"
            value={summary.cancelled}
            tone={summary.cancelled > 0 ? 'text-red-700' : undefined}
            onClick={() => setStatusFilter('cancelled')}
          />
          {/* Expected is what the caterer was booked against; confirmed is what
              the RSVPs actually say. Both matter and they are not the same. */}
          <Stat label="Expected" value={summary.expectedGuests} />
          <Stat label="Confirmed" value={summary.confirmedGuests} tone="text-emerald-700" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search by name, venue or city"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {(['', 'upcoming', 'ongoing', 'completed', 'cancelled'] as const).map((value) => (
          <button
            key={value || 'all'}
            className={`rounded-full border px-3 py-1 text-xs ${
              statusFilter === value
                ? 'border-brand bg-brand text-white'
                : 'border-gray-300 text-gray-700 hover:border-brand'
            }`}
            onClick={() => setStatusFilter(value)}
          >
            {value ? STATUS_LABEL[value] : 'All'}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <div className="card">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-900">Your days</h2>
              <div className="flex gap-1">
                {(['list', 'cards'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`rounded px-2 py-0.5 text-xs ${
                      view === v ? 'bg-brand-light text-brand-dark' : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {v === 'list' ? 'List' : 'Cards'}
                  </button>
                ))}
              </div>
            </div>
            <div className={view === 'cards' ? 'grid gap-2 sm:grid-cols-2' : 'space-y-1'}>
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
                      className={
                        view === 'cards'
                          ? `flex flex-col gap-1 rounded border p-3 ${
                              selected === ev.id
                                ? 'border-brand bg-brand-light'
                                : 'border-gray-200 hover:bg-gray-50'
                            }`
                          : `flex items-center justify-between rounded px-3 py-2 ${
                              selected === ev.id ? 'bg-brand-light' : 'hover:bg-gray-50'
                            }`
                      }
                    >
                      <button className="flex-1 text-left" onClick={() => setSelected(ev.id)}>
                        <span className="block text-sm font-medium text-gray-900">{ev.name}</span>
                        <span className="block text-xs text-gray-500">
                          {formatDate(ev.eventDate)}
                          {ev.startTime ? ` · ${ev.startTime.slice(0, 5)}` : ''}
                          {ev.endTime ? `–${ev.endTime.slice(0, 5)}` : ''}
                          {ev.venue ? ` · ${ev.venue}` : ''}
                          {ev.expectedGuests ? ` · ${ev.expectedGuests} expected` : ''}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1">
                          {ev.status && (
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] ${STATUS_TONE[ev.status]}`}
                            >
                              {STATUS_LABEL[ev.status]}
                            </span>
                          )}
                          {ev.category && (
                            <span className="text-[10px] text-gray-400">
                              {CATEGORY_LABEL[ev.category] ?? ev.category}
                            </span>
                          )}
                          {ev.eventType && (
                            <span className="text-[10px] text-gray-400">· {ev.eventType}</span>
                          )}
                        </span>
                        {/*
                          Where this day stands, on the day itself.

                          The RSVP panel only ever appeared for the one day you
                          had selected, so "how many are coming to the sangeet"
                          took a click per day and the page that was meant to
                          summarise the wedding summarised nothing.
                        */}
                        {ev.rsvp &&
                          ev.rsvp.coming + ev.rsvp.notComing + ev.rsvp.noReply > 0 && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-800">
                                {ev.rsvp.coming} coming
                              </span>
                              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
                                {ev.rsvp.noReply} not answered
                              </span>
                              <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                                {ev.rsvp.notComing} not coming
                              </span>
                            </span>
                          )}
                      </button>
                      <div className="flex gap-1">
                        {/*
                          Straight to the vendors for this day. It was only
                          reachable after selecting the day and scrolling the
                          right-hand panel, which is a long way from "add a
                          button to redirect to the Vendors page".
                        */}
                        <Link
                          className="rounded px-2 py-1 text-xs text-brand-dark hover:bg-gray-100"
                          to={`/vendors?eventId=${ev.id}`}
                          title={`Book vendors for ${ev.name}`}
                        >
                          Vendors
                        </Link>
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

            <button
              type="button"
              className="text-left text-xs text-brand underline"
              onClick={() => setMore(!more)}
            >
              {more ? 'Fewer details' : 'More details — times, guests, budget'}
            </button>

            {more && (
              <div className="space-y-2 border-t pt-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="input"
                    placeholder="Type, e.g. Sangeet"
                    value={draft.eventType ?? ''}
                    onChange={(e) => setDraft({ ...draft, eventType: e.target.value })}
                  />
                  <select
                    className="input"
                    value={draft.category ?? ''}
                    onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                  >
                    <option value="">Category</option>
                    <option value="pre_wedding">Pre-wedding</option>
                    <option value="main">Main event</option>
                    <option value="post_wedding">Post-wedding</option>
                  </select>
                  <input
                    className="input"
                    type="time"
                    title="Start time"
                    value={draft.startTime ?? ''}
                    onChange={(e) => setDraft({ ...draft, startTime: e.target.value })}
                  />
                  <input
                    className="input"
                    type="time"
                    title="End time"
                    value={draft.endTime ?? ''}
                    onChange={(e) => setDraft({ ...draft, endTime: e.target.value })}
                  />
                  <input
                    className="input"
                    type="number"
                    min={0}
                    placeholder="Guests expected"
                    value={draft.expectedGuests ?? ''}
                    onChange={(e) => setDraft({ ...draft, expectedGuests: e.target.value })}
                  />
                  <input
                    className="input"
                    type="number"
                    min={0}
                    placeholder="Budget"
                    value={draft.budget ?? ''}
                    onChange={(e) => setDraft({ ...draft, budget: e.target.value })}
                  />
                </div>
                <input
                  className="input"
                  placeholder="City"
                  value={draft.city ?? ''}
                  onChange={(e) => setDraft({ ...draft, city: e.target.value })}
                />
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Venue address"
                  value={draft.venueAddress ?? ''}
                  onChange={(e) => setDraft({ ...draft, venueAddress: e.target.value })}
                />
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Notes — decoration, food, anything the vendors need"
                  value={draft.description ?? ''}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
            )}
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
              {/*
                What an organiser plans from: how many were asked, how many
                said yes, and how many have not answered. Heads rather than
                invitations for the ones coming, because a household of six
                that is sending two is two — and catering ordered from the
                invitation count feeds four people who are not there.
              */}
              {rsvp && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <GuestStat label="Invited" value={rsvp.invitations.total} />
                  <GuestStat
                    label="Coming"
                    value={rsvp.invitations.attending}
                    note={`${rsvp.people.attending} people`}
                    tone="text-emerald-700"
                  />
                  <GuestStat
                    label="Not answered"
                    value={rsvp.invitations.pending}
                    tone={rsvp.invitations.pending > 0 ? 'text-amber-700' : undefined}
                  />
                  <GuestStat label="Declined" value={rsvp.invitations.declined} />
                </div>
              )}

              <div className="card">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold text-gray-900">Vendors for {current.name}</h2>
                  {/*
                    The event travels with the link. It used to drop it, so an
                    organiser who pressed this landed on a vendor list with
                    nothing selected and had to find the same day again from a
                    dropdown — having just been looking at it.
                  */}
                  <Link className="btn-outline" to={`/vendors?eventId=${current.id}`}>
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

/** One number above the list, and the filter it applies. */
function Stat({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  tone?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold ${tone ?? 'text-gray-900'}`}
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </p>
    </>
  );
  // Only the ones that filter are clickable. A card that looks pressable and
  // does nothing is worse than one that plainly does not.
  return onClick ? (
    <button className="card text-left transition hover:shadow-md" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="card">{body}</div>
  );
}

/** One guest number. Small enough that four fit on a phone, two across. */
function GuestStat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: number;
  note?: string;
  tone?: string;
}) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${tone ?? 'text-gray-900'}`}>{value}</p>
      {note && <p className="text-xs text-gray-500">{note}</p>}
    </div>
  );
}
