import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { formatDate } from '../lib/dates';
import { Loading } from '../components/ui/Feedback';

type EventStatus = 'upcoming' | 'ongoing' | 'completed' | 'cancelled';

const STATUS_LABEL: Record<EventStatus, string> = {
  upcoming: 'Upcoming',
  ongoing: 'Today',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const STATUS_TONE: Record<EventStatus, string> = {
  upcoming: 'bg-sky-50 text-sky-800',
  ongoing: 'bg-emerald-50 text-emerald-800',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-50 text-red-700',
};

interface WEvent {
  id: string;
  name: string;
  venue?: string | null;
  city?: string | null;
  eventDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  expectedGuests?: number | null;
  budget?: string | null;
  theme?: string | null;
  specialRequirements?: string | null;
  description?: string | null;
  plannerNotes?: string | null;
  status?: EventStatus;
  rsvp?: { coming: number; notComing: number; noReply: number };
}
interface ClientEvent extends WEvent {
  clientName: string;
  clientUserId: string;
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
 * The planner's Events workspace (EZ1-I84).
 *
 * One place for every event across the planner's confirmed clients — the same
 * shared event records the couples own, never a duplicate set. The planner
 * reviews each event's overview, the vendors the client has booked, the RSVP
 * picture and the budget, and keeps their own execution notes on it. The couple
 * defines the wedding; the planner coordinates it.
 */
export default function PlannerEvents() {
  const qc = useQueryClient();
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<EventStatus | ''>('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: clients = [] } = useQuery({
    queryKey: ['engaged-hosts'],
    queryFn: async () =>
      (await api.get('/events/engaged')).data as { userId: string; name: string }[],
  });

  // Every confirmed client's events, merged into one list keyed to the client
  // they belong to. The events themselves are the couples' own records.
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['planner-events', clients.map((c) => c.userId).join(',')],
    enabled: clients.length > 0,
    queryFn: async () => {
      const lists = await Promise.all(
        clients.map(async (c) => {
          const rows = (await api.get('/events', { params: { hostUserId: c.userId } }))
            .data as WEvent[];
          return rows.map((e) => ({ ...e, clientName: c.name, clientUserId: c.userId }));
        }),
      );
      return lists.flat() as ClientEvent[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events
      .filter((e) => !clientFilter || e.clientUserId === clientFilter)
      .filter((e) => !statusFilter || e.status === statusFilter)
      .filter(
        (e) =>
          !q ||
          [e.name, e.clientName, e.venue, e.city].filter(Boolean).some((v) =>
            String(v).toLowerCase().includes(q),
          ),
      )
      .sort((a, b) => (a.eventDate ?? '').localeCompare(b.eventDate ?? ''));
  }, [events, clientFilter, statusFilter, search]);

  const counts = useMemo(() => {
    const by = (s: EventStatus) => events.filter((e) => e.status === s).length;
    return {
      total: events.length,
      upcoming: by('upcoming'),
      ongoing: by('ongoing'),
      completed: by('completed'),
      cancelled: by('cancelled'),
    };
  }, [events]);

  const selected = filtered.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Client Events</h1>
        <p className="page-subtitle">
          Every event across the weddings you are running, with the couple's requirements, their
          booked vendors, the RSVP picture and your own notes.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Total" value={counts.total} />
        <Stat label="Upcoming" value={counts.upcoming} />
        <Stat label="Today" value={counts.ongoing} />
        <Stat label="Completed" value={counts.completed} />
        <Stat label="Cancelled" value={counts.cancelled} />
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        <input
          className="input flex-1"
          placeholder="Search event, couple, venue or city"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input w-48" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.userId} value={c.userId}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="input w-40"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as EventStatus | '')}
        >
          <option value="">Any status</option>
          {(Object.keys(STATUS_LABEL) as EventStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <Loading rows={3} />}
      {!isLoading && clients.length === 0 && (
        <div className="card text-sm text-gray-600">
          No confirmed clients yet. A couple appears here once they book you and pay the advance.
        </div>
      )}
      {!isLoading && clients.length > 0 && filtered.length === 0 && (
        <div className="card text-sm text-gray-600">No events match that search.</div>
      )}

      <div className="grid gap-4 lg:grid-cols-[20rem,1fr]">
        {filtered.length > 0 && (
          <ul className="space-y-2">
            {filtered.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => setSelectedId(e.id)}
                  className={`w-full rounded-lg border p-3 text-left ${
                    selectedId === e.id ? 'border-brand bg-brand-light' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-900">{e.name}</span>
                    {e.status && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${STATUS_TONE[e.status]}`}>
                        {STATUS_LABEL[e.status]}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">{e.clientName}</p>
                  <p className="text-xs text-gray-500">
                    {[e.eventDate ? formatDate(e.eventDate) : null, e.venue, e.city]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected && <EventWorkspace event={selected} onSaved={() => qc.invalidateQueries({ queryKey: ['planner-events'] })} />}
      </div>
    </div>
  );
}

/** The event-level workspace: overview, vendors, guests, budget and notes. */
function EventWorkspace({ event, onSaved }: { event: ClientEvent; onSaved: () => void }) {
  const [tab, setTab] = useState<'overview' | 'vendors' | 'guests' | 'budget' | 'notes'>('overview');
  const money = (v?: string | null) =>
    v && Number(v) > 0 ? `₹${Number(v).toLocaleString('en-IN')}` : '—';

  const { data: vendors = [] } = useQuery({
    queryKey: ['planner-event-vendors', event.id],
    enabled: tab === 'vendors',
    queryFn: async () => (await api.get(`/events/${event.id}/vendors`)).data as EventVendor[],
  });

  const rsvp = event.rsvp ?? { coming: 0, notComing: 0, noReply: 0 };
  const TABS: { key: typeof tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'vendors', label: 'Vendors' },
    { key: 'guests', label: 'Guests' },
    { key: 'budget', label: 'Budget' },
    { key: 'notes', label: 'Notes' },
  ];

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="section-title">{event.name}</h2>
        <p className="text-sm text-gray-500">
          {event.clientName}
          {event.eventDate ? ` · ${formatDate(event.eventDate)}` : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
              tab === t.key
                ? 'border-brand font-medium text-brand-dark'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Fact label="Couple">{event.clientName}</Fact>
          <Fact label="Date">{event.eventDate ? formatDate(event.eventDate) : '—'}</Fact>
          <Fact label="Time">
            {event.startTime ? `${event.startTime.slice(0, 5)}${event.endTime ? `–${event.endTime.slice(0, 5)}` : ''}` : '—'}
          </Fact>
          <Fact label="Venue">{[event.venue, event.city].filter(Boolean).join(', ') || '—'}</Fact>
          <Fact label="Expected guests">{event.expectedGuests ?? '—'}</Fact>
          <Fact label="Budget">{money(event.budget)}</Fact>
          <Fact label="Theme / preferences">{event.theme || '—'}</Fact>
          <Fact label="Status">{event.status ? STATUS_LABEL[event.status] : '—'}</Fact>
          {event.specialRequirements && (
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-gray-400">Special requirements</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-gray-700">{event.specialRequirements}</dd>
            </div>
          )}
          {event.description && (
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-gray-400">Notes from the couple</dt>
              <dd className="mt-0.5 whitespace-pre-wrap text-gray-700">{event.description}</dd>
            </div>
          )}
          <div className="sm:col-span-2 pt-1">
            <Link className="btn-outline btn-sm" to={`/planner`}>
              Open the wedding plan &amp; tasks
            </Link>
          </div>
        </dl>
      )}

      {tab === 'vendors' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            Vendors the couple has booked for this event. Coordinate with them rather than
            re-booking.
          </p>
          {vendors.length === 0 ? (
            <p className="text-sm text-gray-400">No vendors booked for this event yet.</p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {vendors.map((v) => (
                <li key={v.bookingId} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-gray-800">{v.providerName}</span>
                    {v.category ? <span className="text-gray-400"> · {v.category}</span> : null}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-gray-600">
                      {v.status.replace(/_/g, ' ')}
                    </span>
                    <span className="tabular-nums text-gray-600">{money(v.amount)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'guests' && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Coming" value={rsvp.coming} />
          <Stat label="Not coming" value={rsvp.notComing} />
          <Stat label="Not responded" value={rsvp.noReply} />
        </div>
      )}

      {tab === 'budget' && (
        <div className="space-y-2">
          <Stat label="Event budget" value={money(event.budget)} />
          <p className="text-xs text-gray-500">
            The budget the couple set for this event. Booked vendors above count against it.
          </p>
        </div>
      )}

      {tab === 'notes' && <NotesEditor event={event} onSaved={onSaved} />}
    </div>
  );
}

/** The planner's own execution notes on the shared event (EZ1-I84). */
function NotesEditor({ event, onSaved }: { event: ClientEvent; onSaved: () => void }) {
  const [notes, setNotes] = useState(event.plannerNotes ?? '');
  const [msg, setMsg] = useState('');
  const save = useMutation({
    mutationFn: async () => api.put(`/events/${event.id}`, { plannerNotes: notes }),
    onSuccess: () => {
      setMsg('Saved.');
      onSaved();
    },
    onError: (err) => setMsg(apiMessage(err, 'Could not save the notes.')),
  });

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        Your own planning and execution notes for this event. The couple keeps their requirements in
        the overview; this is yours.
      </p>
      <textarea
        className="input"
        rows={5}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Running order, supplier contacts, on-the-day reminders…"
      />
      <div className="flex items-center gap-3">
        <button className="btn" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save notes'}
        </button>
        {msg && <span className="text-sm text-gray-500">{msg}</span>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card text-center">
      <p className="text-xl font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-gray-800">{children}</dd>
    </div>
  );
}
