import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { MagnifyingGlass, Users } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { formatDate } from '../lib/dates';
import { EmptyState, Loading } from '../components/ui/Feedback';

/**
 * The weddings this planner was hired to run.
 *
 * Their own Events page lists their own days, of which there are none — a
 * planner is not the one getting married. This is the other side: the couples
 * they are responsible for, which until now could only be reached one plan at
 * a time through the timeline, with no way to see who the client actually is.
 *
 * Filtering is client-side because a planner's book is tens of weddings, not
 * thousands, and a round trip per keystroke would be slower and worse.
 */

interface Client {
  userId: string;
  planId: string;
  name: string;
  bride: string | null;
  groom: string | null;
  email: string | null;
  phone: string | null;
  weddingDate: string | null;
  location: string | null;
  events: number;
  nextEvent: { id: string; name: string; date: string | null } | null;
  tasks: { total: number; done: number };
  bookings: { total: number; confirmed: number; pending: number };
  status: 'active' | 'upcoming' | 'completed';
}

interface Request {
  bookingId: string;
  userId: string;
  name: string;
  amount: string;
  currency: string;
  requestedAt: string;
}

const STATUS_TONE: Record<Client['status'], string> = {
  active: 'bg-emerald-50 text-emerald-800',
  upcoming: 'bg-amber-50 text-amber-800',
  completed: 'bg-gray-100 text-gray-700',
};

const TABS: { key: 'all' | Client['status']; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
];

export default function PlannerClients() {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'all' | Client['status']>('all');
  const [city, setCity] = useState('');

  const { data, isLoading } = useQuery<{ clients: Client[]; requests: Request[] }>({
    queryKey: ['planner-clients'],
    queryFn: async () => (await api.get('/planner/clients')).data,
    retry: false,
  });

  const clients = data?.clients ?? [];
  const cities = useMemo(
    () => [...new Set(clients.map((c) => c.location).filter(Boolean))] as string[],
    [clients],
  );

  const rows = clients.filter((c) => {
    if (tab !== 'all' && c.status !== tab) return false;
    if (city && c.location !== city) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.bride, c.groom, c.email, c.phone]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });

  const countFor = (key: (typeof TABS)[number]['key']) =>
    key === 'all' ? clients.length : clients.filter((c) => c.status === key).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">My Clients</h1>
        <p className="page-subtitle">
          The couples you are engaged on. Each one opens onto their wedding, its events, the
          tasks and what has been committed.
        </p>
      </div>

      {/*
        Requests first, because they are the only thing here with somebody
        waiting at the other end of it.
      */}
      {(data?.requests.length ?? 0) > 0 && (
        <div className="card border-l-4 border-l-brand">
          <h2 className="section-title">
            {data!.requests.length} request{data!.requests.length === 1 ? '' : 's'} waiting on you
          </h2>
          <p className="mt-0.5 text-sm text-gray-600">
            A couple has asked you to plan their wedding and has not heard back. These are not
            clients yet — they become clients once you accept and the booking is confirmed.
          </p>
          <ul className="mt-3 divide-y">
            {data!.requests.map((r) => (
              <li
                key={r.bookingId}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div>
                  <p className="font-medium text-gray-900">{r.name}</p>
                  <p className="text-xs text-gray-500">
                    Asked {formatDate(r.requestedAt)}
                    {Number(r.amount) > 0 &&
                      ` · ${r.currency} ${Number(r.amount).toLocaleString('en-IN')}`}
                  </p>
                </div>
                <Link className="btn-outline btn-sm" to="/bookings">
                  Review
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'btn btn-sm' : 'btn-outline btn-sm'}
            onClick={() => setTab(t.key)}
          >
            {t.label} ({countFor(t.key)})
          </button>
        ))}
        <div className="relative ml-auto min-w-[12rem] flex-1 sm:max-w-xs">
          <MagnifyingGlass
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            aria-hidden
          />
          <input
            className="input w-full py-1.5 pl-8 text-sm"
            placeholder="Name, email or phone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {cities.length > 1 && (
          <select
            className="input w-36 py-1.5 text-sm"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          >
            <option value="">Anywhere</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </div>

      {isLoading && <Loading rows={4} />}

      {!isLoading && rows.length === 0 && (
        <div className="card">
          <EmptyState icon={Users} title="No confirmed clients yet">
            A couple becomes your client when they book you and the booking is confirmed.
            {(data?.requests.length ?? 0) > 0
              ? ' You have requests waiting above — accept one to get started.'
              : ' Until then they will not appear here.'}
          </EmptyState>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((c) => (
          <Link
            key={c.userId}
            to={`/my-clients/${c.userId}`}
            className="card flex flex-col transition hover:border-gray-300 hover:shadow-card"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="section-title">{c.name}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${STATUS_TONE[c.status]}`}>
                {c.status}
              </span>
            </div>

            {/*
              Both names, because a couple is two people and a card showing one
              of them is how a planner opens the wrong wedding.
            */}
            {(c.bride || c.groom) && (
              <p className="text-sm text-gray-600">
                {[c.bride, c.groom].filter(Boolean).join(' & ')}
              </p>
            )}

            <dl className="mt-3 space-y-1 text-sm">
              <Row label="Wedding" value={c.weddingDate ? formatDate(c.weddingDate) : 'Not set'} />
              <Row label="Where" value={c.location ?? '-'} />
              <Row label="Events" value={String(c.events)} />
              <Row label="Tasks done" value={`${c.tasks.done} of ${c.tasks.total}`} />
              <Row
                label="Bookings"
                value={
                  c.bookings.total === 0
                    ? 'None yet'
                    : `${c.bookings.confirmed} confirmed${
                        c.bookings.pending > 0 ? `, ${c.bookings.pending} pending` : ''
                      }`
                }
              />
              <Row
                label="Next"
                value={
                  c.nextEvent
                    ? `${c.nextEvent.name}${c.nextEvent.date ? `, ${formatDate(c.nextEvent.date)}` : ''}`
                    : 'Nothing scheduled'
                }
              />
            </dl>

            <p className="mt-3 text-sm font-medium text-brand-strong">View client</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="truncate text-right font-medium text-gray-900">{value}</dd>
    </div>
  );
}
