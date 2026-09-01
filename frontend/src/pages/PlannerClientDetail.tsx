import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from '@phosphor-icons/react';
import { api, apiMessage } from '../lib/api';
import { formatDate } from '../lib/dates';
import { BOOKING_STATUS_LABEL } from '../lib/permissions';
import { Loading } from '../components/ui/Feedback';

/**
 * One client, everything about their wedding, on one screen.
 *
 * The numbers here are not recomputed for the planner. Budget, guest counts
 * and planning progress all come from the same service that draws the couple's
 * own dashboard, so the two sides of a wedding are looking at the same figures.
 * A second derivation would drift, and the planner's copy is the one nobody
 * would notice drifting.
 */

interface Detail {
  client: {
    userId: string;
    name: string;
    bride: string | null;
    groom: string | null;
    email: string | null;
    phone: string | null;
    city: string | null;
    status: string;
  };
  wedding: {
    planId: string;
    weddingDate: string | null;
    countdown: { weddingDate: string | null; daysAway: number | null; passed: boolean };
    functions: number;
    venues: string[];
    cities: string[];
  };
  progress: unknown;
  guests: Record<string, unknown>;
  budget: {
    budgeted: string;
    committed: string;
    remaining: string;
    overBudget: boolean;
    categories: { category: string; budgeted: string; committed: string; remaining: string }[];
  };
  events: {
    id: string;
    name: string;
    date: string | null;
    venue: string;
    city: string | null;
    startTime: string | null;
    budget: string | null;
    status: string;
  }[];
  tasks: { id: string; title: string; category: string; dueDate: string | null; status: string }[];
  vendors: {
    bookingId: string;
    name: string;
    category: string;
    status: string;
    amount: string;
    currency: string;
    eventDate: string | null;
  }[];
}

const TASK_TONE: Record<string, string> = {
  done: 'bg-emerald-50 text-emerald-800',
  in_progress: 'bg-amber-50 text-amber-800',
  pending: 'bg-gray-100 text-gray-600',
};

export default function PlannerClientDetail() {
  const { userId } = useParams<{ userId: string }>();

  const { data, isPending, error } = useQuery<Detail>({
    queryKey: ['planner-client', userId],
    queryFn: async () => (await api.get(`/planner/clients/${userId}`)).data,
    enabled: Boolean(userId),
    retry: false,
  });

  if (isPending) return <Loading rows={6} />;
  if (error) {
    return (
      <div className="card">
        <p className="alert-critical">
          {apiMessage(error, 'That client could not be opened.')}
        </p>
        <Link className="btn-outline mt-3 inline-flex" to="/my-clients">
          Back to clients
        </Link>
      </div>
    );
  }

  const { client, wedding, budget, events, tasks, vendors } = data;
  const money = (v: string | number) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
  const doneCount = tasks.filter((t) => t.status === 'done').length;

  return (
    <div className="space-y-4">
      <div>
        <Link className="inline-flex items-center gap-1 text-sm text-gray-500" to="/my-clients">
          <ArrowLeft size={14} aria-hidden />
          All clients
        </Link>
        <h1 className="page-title mt-1">{client.name}</h1>
        <p className="page-subtitle">
          {[client.bride, client.groom].filter(Boolean).join(' & ') || 'Client'}
          {client.city ? ` · ${client.city}` : ''}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Wedding" value={wedding.weddingDate ? formatDate(wedding.weddingDate) : 'Not set'} />
        <Stat
          label="Days away"
          value={
            wedding.countdown.daysAway == null
              ? '-'
              : wedding.countdown.passed
                ? 'Passed'
                : String(wedding.countdown.daysAway)
          }
        />
        <Stat label="Functions" value={String(wedding.functions)} />
        <Stat label="Tasks done" value={`${doneCount} of ${tasks.length}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Client">
          <Row label="Email" value={client.email ?? '-'} />
          <Row label="Phone" value={client.phone ?? '-'} />
          <Row label="Bride" value={client.bride ?? '-'} />
          <Row label="Groom" value={client.groom ?? '-'} />
          <Row label="Status" value={client.status} />
        </Section>

        {/*
          The budget is the couple's own figures, not a planner-side copy: the
          same service draws both, so the two sides never disagree about what
          has been committed.
        */}
        <Section title="Budget">
          <Row label="Planned" value={money(budget.budgeted)} />
          <Row label="Committed" value={money(budget.committed)} />
          <Row
            label="Remaining"
            value={money(budget.remaining)}
            tone={budget.overBudget ? 'text-red-700' : undefined}
          />
          {budget.categories.slice(0, 5).map((c) => (
            <Row
              key={c.category}
              label={c.category.replace(/_/g, ' ')}
              value={`${money(c.committed)} of ${money(c.budgeted)}`}
            />
          ))}
        </Section>
      </div>

      <div className="card">
        <h2 className="section-title">Events</h2>
        {events.length === 0 ? (
          <p className="mt-1 text-sm text-gray-500">No functions have been added yet.</p>
        ) : (
          <div className="mt-2 divide-y">
            {events.map((e) => (
              <div key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">{e.name}</p>
                  <p className="text-xs text-gray-500">
                    {[e.venue, e.city].filter(Boolean).join(', ') || 'Venue not set'}
                    {e.startTime ? ` · ${e.startTime}` : ''}
                  </p>
                </div>
                <p className="text-sm text-gray-600">
                  {e.date ? formatDate(e.date) : 'Date not set'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="section-title">Tasks</h2>
        {tasks.length === 0 ? (
          <p className="mt-1 text-sm text-gray-500">
            Nothing on the plan yet. Tasks are added from the wedding plan.
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
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${TASK_TONE[t.status] ?? TASK_TONE.pending}`}
                >
                  {t.status.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="section-title">Vendors and services</h2>
        {vendors.length === 0 ? (
          <p className="mt-1 text-sm text-gray-500">Nothing booked yet.</p>
        ) : (
          <div className="mt-2 divide-y">
            {vendors.map((v) => (
              <div key={v.bookingId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">{v.name}</p>
                  <p className="text-xs capitalize text-gray-500">
                    {String(v.category).replace(/_/g, ' ')}
                    {v.eventDate ? ` · ${formatDate(v.eventDate)}` : ''}
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2 className="section-title">{title}</h2>
      <dl className="mt-2 space-y-1 text-sm">{children}</dl>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="capitalize text-gray-500">{label}</dt>
      <dd className={`truncate text-right font-medium ${tone ?? 'text-gray-900'}`}>{value}</dd>
    </div>
  );
}
