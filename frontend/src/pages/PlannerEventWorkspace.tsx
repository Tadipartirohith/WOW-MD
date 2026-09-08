import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from '@phosphor-icons/react';
import { api, apiMessage } from '../lib/api';
import { formatDate } from '../lib/dates';
import { BOOKING_STATUS_LABEL } from '../lib/permissions';
import { Loading } from '../components/ui/Feedback';

/**
 * One shared wedding event, opened by the planner (EZ1-I84).
 *
 * The same record the couple own — vendors, guests, tasks, budget and notes on
 * one screen. Nothing here is a planner-side copy: the guests are the couple's
 * own RSVP data, the vendors are the bookings they placed, and the tasks come
 * from the wedding plan. The planner runs the day (notes, status); anything
 * they change is synced back to the couple by the server.
 */

interface Workspace {
  event: {
    id: string;
    userId: string;
    name: string;
    eventType: string | null;
    category: string | null;
    eventDate: string | null;
    startTime: string | null;
    endTime: string | null;
    venue: string | null;
    venueAddress: string | null;
    city: string | null;
    expectedGuests: number | null;
    budget: string | null;
    status: EventStatus;
  };
  plannerEngaged: boolean;
  vendors: {
    bookingId: string;
    status: string;
    amount: string;
    providerName: string;
    category: string | null;
    providerType: string;
  }[];
  guests: {
    summary: {
      onList: number;
      attending: number;
      declined: number;
      maybe: number;
      awaiting: number;
      expectedHeadcount: number;
    };
    rows: {
      inviteId: string;
      name: string;
      status: string;
      attendingCount: number | null;
      invitedPartySize: number | null;
    }[];
  };
  tasks: { id: string; title: string; category: string; dueDate: string | null; status: string }[];
  budget: { budgeted: string; committed: string; remaining: string; overBudget: boolean };
  notes: {
    theme: string | null;
    specialRequirements: string | null;
    plannerNotes: string | null;
    description: string | null;
  };
}

type EventStatus = 'upcoming' | 'ongoing' | 'completed' | 'cancelled';

const STATUS_LABEL: Record<EventStatus, string> = {
  upcoming: 'Upcoming',
  ongoing: 'Today',
  completed: 'Done',
  cancelled: 'Cancelled',
};

const TAB_KEYS = ['overview', 'vendors', 'tasks', 'guests', 'budget', 'notes'] as const;
type Tab = (typeof TAB_KEYS)[number];
const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  vendors: 'Vendors',
  tasks: 'Tasks',
  guests: 'Guests',
  budget: 'Budget',
  notes: 'Notes',
};

const money = (v: string | number) => `₹${Number(v || 0).toLocaleString('en-IN')}`;

export default function PlannerEventWorkspace() {
  const { userId, eventId } = useParams<{ userId: string; eventId: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');

  const { data, isPending, error } = useQuery<Workspace>({
    queryKey: ['event-workspace', eventId],
    queryFn: async () => (await api.get(`/events/${eventId}/workspace`)).data,
    enabled: Boolean(eventId),
    retry: false,
  });

  if (isPending) return <Loading rows={6} />;
  if (error) {
    return (
      <div className="card">
        <p className="alert-critical">{apiMessage(error, 'That event could not be opened.')}</p>
        <Link className="btn-outline mt-3 inline-flex" to={`/my-clients/${userId}`}>
          Back to client
        </Link>
      </div>
    );
  }

  const { event, vendors, guests, tasks, budget, notes } = data;

  return (
    <div className="space-y-4">
      <div>
        <Link
          className="inline-flex items-center gap-1 text-sm text-gray-500"
          to={`/my-clients/${userId}`}
        >
          <ArrowLeft size={14} aria-hidden />
          Back to client
        </Link>
        <h1 className="page-title mt-1">{event.name}</h1>
        <p className="page-subtitle">
          {event.eventDate ? formatDate(event.eventDate) : 'Date not set'}
          {event.startTime ? ` · ${event.startTime}` : ''}
          {[event.venue, event.city].filter(Boolean).length
            ? ` · ${[event.venue, event.city].filter(Boolean).join(', ')}`
            : ''}
        </p>
      </div>

      {/* Tabs across the shared record. */}
      <div className="flex flex-wrap gap-2">
        {TAB_KEYS.map((k) => (
          <button
            key={k}
            className={tab === k ? 'btn btn-sm' : 'btn-outline btn-sm'}
            onClick={() => setTab(k)}
          >
            {TAB_LABEL[k]}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Status" value={STATUS_LABEL[event.status] ?? event.status} />
          <Stat
            label="Expected"
            value={event.expectedGuests != null ? String(event.expectedGuests) : '-'}
          />
          <Stat label="Coming" value={String(guests.summary.expectedHeadcount)} />
          <Stat label="Committed" value={money(budget.committed)} />
        </div>
      )}

      {tab === 'vendors' && (
        <div className="card">
          <h2 className="section-title">Vendors booked for this day</h2>
          {vendors.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">
              Nothing booked for this function yet. Vendors the couple booked appear here.
            </p>
          ) : (
            <div className="mt-2 divide-y">
              {vendors.map((v) => (
                <div
                  key={v.bookingId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{v.providerName}</p>
                    <p className="text-xs capitalize text-gray-500">
                      {String(v.category ?? v.providerType).replace(/_/g, ' ')}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{money(v.amount)}</p>
                    <p className="text-xs text-gray-500">
                      {BOOKING_STATUS_LABEL[v.status] ?? v.status.replace(/_/g, ' ')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'tasks' && (
        <div className="card">
          <h2 className="section-title">Plan tasks</h2>
          {tasks.length === 0 ? (
            <p className="mt-1 text-sm text-gray-500">
              Nothing on the plan yet. Tasks are managed from the wedding plan.
            </p>
          ) : (
            <div className="mt-2 divide-y">
              {tasks.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{t.title}</p>
                    <p className="text-xs text-gray-500">
                      {t.category}
                      {t.dueDate ? ` · due ${formatDate(t.dueDate)}` : ''}
                    </p>
                  </div>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">
                    {t.status.replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'guests' && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="On list" value={String(guests.summary.onList)} />
            <Stat label="Coming" value={String(guests.summary.attending)} />
            <Stat label="Declined" value={String(guests.summary.declined)} />
            <Stat label="Maybe" value={String(guests.summary.maybe)} />
            <Stat label="Awaiting" value={String(guests.summary.awaiting)} />
          </div>
          <div className="card">
            <h2 className="section-title">Guests</h2>
            {guests.rows.length === 0 ? (
              <p className="mt-1 text-sm text-gray-500">
                No invitations yet. The couple's guest list is shared here — there is no separate
                planner list.
              </p>
            ) : (
              <div className="mt-2 divide-y">
                {guests.rows.map((g) => (
                  <div
                    key={g.inviteId}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <p className="text-sm font-medium text-gray-900">{g.name}</p>
                    <p className="text-xs capitalize text-gray-500">
                      {g.status.replace(/_/g, ' ')}
                      {g.attendingCount != null ? ` · ${g.attendingCount} coming` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'budget' && (
        <div className="card">
          <h2 className="section-title">Budget for this function</h2>
          <dl className="mt-2 space-y-1 text-sm">
            <Row label="Planned" value={money(budget.budgeted)} />
            <Row label="Committed" value={money(budget.committed)} />
            <Row
              label="Remaining"
              value={money(budget.remaining)}
              tone={budget.overBudget ? 'text-red-700' : undefined}
            />
          </dl>
          <p className="mt-2 text-xs text-gray-500">
            Committed is what the couple's bookings for this day actually came to — the same figures
            they see.
          </p>
        </div>
      )}

      {tab === 'notes' && <NotesTab eventId={eventId as string} notes={notes} onSaved={() =>
        qc.invalidateQueries({ queryKey: ['event-workspace', eventId] })} />}
    </div>
  );
}

/**
 * The planner's running notes on the day, plus the couple's own theme and
 * requirements (read-only here — those belong to the couple). Saving the notes
 * writes the shared record and the couple are notified.
 */
function NotesTab({
  eventId,
  notes,
  onSaved,
}: {
  eventId: string;
  notes: Workspace['notes'];
  onSaved: () => void;
}) {
  const [text, setText] = useState(notes.plannerNotes ?? '');

  const save = useMutation({
    mutationFn: async () => api.put(`/events/${eventId}`, { plannerNotes: text }),
    onSuccess: onSaved,
  });

  return (
    <div className="space-y-3">
      <div className="card">
        <h2 className="section-title">From the couple</h2>
        <dl className="mt-2 space-y-1 text-sm">
          <Row label="Theme" value={notes.theme || '-'} />
          <Row label="Requirements" value={notes.specialRequirements || '-'} />
          <Row label="Details" value={notes.description || '-'} />
        </dl>
      </div>

      <div className="card">
        <h2 className="section-title">Planning notes</h2>
        <p className="text-xs text-gray-500">
          Your execution notes for this day. The couple can see these.
        </p>
        <textarea
          className="input mt-2 min-h-[8rem]"
          value={text}
          maxLength={4000}
          onChange={(e) => setText(e.target.value)}
          placeholder="Run sheet, vendor call times, anything the day needs."
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            className="btn"
            disabled={save.isPending || text === (notes.plannerNotes ?? '')}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save notes'}
          </button>
          {save.isError && (
            <span className="text-xs text-red-700">
              {apiMessage(save.error, 'Could not save.')}
            </span>
          )}
          {save.isSuccess && !save.isPending && (
            <span className="text-xs text-emerald-700">Saved.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card text-center">
      <p className="page-title">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="capitalize text-gray-500">{label}</dt>
      <dd className={`text-right font-medium ${tone ?? 'text-gray-900'}`}>{value}</dd>
    </div>
  );
}
