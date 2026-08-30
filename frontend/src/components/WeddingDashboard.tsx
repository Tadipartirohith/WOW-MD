import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate } from '../lib/dates';

interface Dashboard {
  countdown: {
    weddingDate: string | null;
    daysAway: number | null;
    passed: boolean;
    source: string | null;
  };
  budget: {
    budgeted: string;
    committed: string;
    remaining: string;
    overBudget: boolean;
    categories: { category: string; budgeted: string; committed: string; remaining: string }[];
  };
  guests: {
    onList: number;
    invited: number;
    attending: number;
    declined: number;
    maybe: number;
    awaiting: number;
    expectedHeadcount: number;
  };
  journey: {
    total: number;
    done: number;
    percent: number;
    overdue: number;
    nextUp: string | null;
    stages: { stage: string; total: number; done: number; nextDue: string | null }[];
  };
  upcoming: {
    id: string;
    name: string;
    eventDate: string;
    venue: string | null;
    daysAway: number;
    expectedGuests: number | null;
  }[];
}

const money = (v: string) => `₹${Number(v).toLocaleString('en-IN')}`;

/**
 * The wedding, on one screen.
 *
 * Every number here already existed somewhere — on the plan, on the events, on
 * the guest list, in the bookings. What did not exist was anywhere that put
 * them together, so "how is it going" meant opening four pages and doing the
 * arithmetic yourself.
 *
 * It leads with the countdown because that is what people open this for, and
 * everything else is ordered by how likely it is to need action: money, then
 * what is late, then who has not replied.
 */
export default function WeddingDashboard() {
  const { data } = useQuery<Dashboard>({
    queryKey: ['wedding-dashboard'],
    queryFn: async () => (await api.get('/planner/dashboard')).data,
    retry: false,
  });

  if (!data) return null;

  const { countdown, budget, guests, journey, upcoming } = data;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-gray-500">
            {countdown.passed ? 'The day was' : 'Days to go'}
          </p>
          {countdown.weddingDate ? (
            <>
              <p
                className={`text-3xl font-bold tabular-nums ${
                  countdown.passed ? 'text-gray-500' : 'text-brand'
                }`}
              >
                {countdown.daysAway === 0
                  ? 'Today'
                  : Math.abs(countdown.daysAway ?? 0).toLocaleString('en-IN')}
              </p>
              <p className="text-xs text-gray-500">
                {formatDate(countdown.weddingDate)}
                {countdown.source === 'event' && ' · from your first event'}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-500">Set a date below to start the countdown.</p>
          )}
        </div>

        <div className="card">
          <p className="text-xs uppercase tracking-wide text-gray-500">Committed</p>
          <p className="text-2xl font-semibold tabular-nums text-gray-900">
            {money(budget.committed)}
          </p>
          <p className={`text-xs ${budget.overBudget ? 'text-red-700' : 'text-gray-500'}`}>
            {Number(budget.budgeted) > 0
              ? budget.overBudget
                ? `${money(String(Math.abs(Number(budget.remaining))))} over budget`
                : `${money(budget.remaining)} left of ${money(budget.budgeted)}`
              : 'No budget set on your events yet'}
          </p>
        </div>

        <div className="card">
          <p className="text-xs uppercase tracking-wide text-gray-500">Coming</p>
          <p className="text-2xl font-semibold tabular-nums text-gray-900">
            {guests.expectedHeadcount}
          </p>
          {/*
            Heads rather than invitations, because that is the number catering
            is ordered from — and the two differ by a lot when households reply
            with fewer than were invited.
          */}
          <p className="text-xs text-gray-500">
            {guests.attending} of {guests.invited} invitations · {guests.awaiting} not answered
          </p>
        </div>

        <div className="card">
          <p className="text-xs uppercase tracking-wide text-gray-500">Plan</p>
          <p className="text-2xl font-semibold tabular-nums text-gray-900">{journey.percent}%</p>
          <p className={`text-xs ${journey.overdue > 0 ? 'text-amber-700' : 'text-gray-500'}`}>
            {journey.overdue > 0
              ? `${journey.overdue} overdue`
              : `${journey.done} of ${journey.total} done`}
          </p>
        </div>
      </div>

      {journey.nextUp && (
        <div className="card flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {journey.overdue > 0 ? 'Late' : 'Next'}
            </p>
            <p className="font-medium text-gray-900">{journey.nextUp}</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {budget.categories.length > 0 && (
          <div className="card">
            <h2 className="section-title">Where the money is going</h2>
            <p className="mb-2 text-xs text-gray-500">
              Budgeted is what you put on each event. Committed is what your bookings actually came
              to. A caterer lands under catering whether or not you budgeted for one.
            </p>
            <div className="divide-y">
              {budget.categories.map((c) => {
                const over = Number(c.remaining) < 0;
                const pct =
                  Number(c.budgeted) > 0
                    ? Math.min(100, Math.round((Number(c.committed) / Number(c.budgeted)) * 100))
                    : 100;
                return (
                  <div key={c.category} className="py-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="capitalize text-gray-700">
                        {c.category.replace(/_/g, ' ')}
                      </span>
                      <span className="tabular-nums text-gray-900">
                        {money(c.committed)}
                        {Number(c.budgeted) > 0 && (
                          <span className="text-gray-400"> / {money(c.budgeted)}</span>
                        )}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-sm bg-gray-100">
                      <div
                        className={`h-1.5 rounded-sm ${over ? 'bg-red-500' : 'bg-brand'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="card">
          <h2 className="section-title">What is next</h2>
          {upcoming.length === 0 && (
            <p className="mt-2 text-sm text-gray-500">
              Nothing on the calendar.{' '}
              <Link className="text-brand underline" to="/events">
                Add your events
              </Link>{' '}
              and they will show up here.
            </p>
          )}
          <div className="divide-y">
            {upcoming.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{e.name}</p>
                  <p className="text-xs text-gray-500">
                    {formatDate(e.eventDate)}
                    {e.venue ? ` · ${e.venue}` : ''}
                    {e.expectedGuests ? ` · ${e.expectedGuests} expected` : ''}
                  </p>
                </div>
                <span className="whitespace-nowrap text-xs tabular-nums text-gray-500">
                  {e.daysAway === 0 ? 'today' : `in ${e.daysAway}d`}
                </span>
              </div>
            ))}
          </div>

          {journey.stages.length > 0 && (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
                The journey
              </h3>
              <div className="mt-1 divide-y">
                {journey.stages.map((sg) => (
                  <div key={sg.stage} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="capitalize text-gray-700">{sg.stage.replace(/_/g, ' ')}</span>
                    <span className="tabular-nums text-gray-500">
                      {sg.done}/{sg.total}
                      {sg.nextDue && sg.done < sg.total && (
                        <span className="ml-2 text-xs text-gray-400">
                          next {formatDate(sg.nextDue)}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
