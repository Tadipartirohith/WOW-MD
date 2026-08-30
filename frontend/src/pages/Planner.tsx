import { FormEvent, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { NOT_SET, daysAway, formatDate, hasDate, relativeToToday } from '../lib/dates';
import WeddingDashboard from '../components/WeddingDashboard';

interface Task {
  id: string;
  title: string;
  category: string;
  dueDate: string | null;
  status: string;
}

interface Plan {
  id: string;
  weddingDate: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'To do',
  in_progress: 'In progress',
  done: 'Done',
};

/**
 * The couple's own wedding plan: their date, and the timeline generated from it.
 *
 * Distinct from `/wedding-planners`, which is the marketplace where a planner
 * is hired. The two used to be called "Planner" and "Planners", which is a
 * distinction nobody can hold in their head — hence the names here.
 *
 * Every date on this page goes through `lib/dates`. Rendering `{dueDate}` raw
 * was the reported defect: a task with no due date printed "due " and a plan
 * with no wedding date printed nothing at all, so the page looked broken rather
 * than unfilled.
 */
export default function Planner() {
  const qc = useQueryClient();
  const [weddingDate, setWeddingDate] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data: plans = [] } = useQuery({
    queryKey: ['plans'],
    queryFn: async () => (await api.get('/planner/plans')).data as Plan[],
  });

  const { data: timeline } = useQuery({
    queryKey: ['timeline', selected],
    queryFn: async () => (await api.get(`/planner/plan/${selected}/timeline`)).data,
    enabled: !!selected,
  });

  // Opening straight onto the only plan somebody has saves a click that exists
  // solely because the list is a list.
  useEffect(() => {
    if (!selected && plans.length > 0) setSelected(plans[0].id);
  }, [plans, selected]);

  async function createPlan(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const { data } = await api.post('/planner/plan', { weddingDate });
      setSelected(data.id);
      qc.invalidateQueries({ queryKey: ['plans'] });
      setWeddingDate('');
    } catch (err) {
      setError(apiMessage(err, 'That plan could not be created.'));
    }
  }

  async function cycleStatus(task: Task) {
    const next =
      task.status === 'pending' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'pending';
    setError('');
    try {
      await api.put(`/planner/tasks/${task.id}/status`, { status: next });
      qc.invalidateQueries({ queryKey: ['timeline', selected] });
    } catch (err) {
      setError(apiMessage(err, 'That change was not saved.'));
    }
  }

  const tasks: Task[] = timeline?.tasks ?? [];
  const current = plans.find((p) => p.id === selected);
  const away = daysAway(current?.weddingDate);
  const done = tasks.filter((t) => t.status === 'done').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">My Wedding Plan</h1>
        <p className="page-subtitle">
          Your own timeline, worked backwards from the wedding date. Looking to{' '}
          <Link className="text-brand underline" to="/wedding-planners">
            hire a wedding planner
          </Link>
          ? That is a different page.
        </p>
      </div>

      {error && <p className="alert-critical">{error}</p>}

      {/*
        Above the form on purpose. Somebody who already has a plan opens this
        page to see how it is going, not to make another one — and the create
        form was the first thing they met every time.
      */}
      <WeddingDashboard />

      <form onSubmit={createPlan} className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="wedding-date">
            Wedding date
          </label>
          {/*
            The picker refuses a past date rather than accepting one and
            generating a timeline that was entirely overdue on the day it was
            made. The server refuses it too — this only saves the round trip.
          */}
          <input
            id="wedding-date"
            className="input"
            type="date"
            min={new Date().toISOString().slice(0, 10)}
            value={weddingDate}
            onChange={(e) => setWeddingDate(e.target.value)}
            required
          />
        </div>
        <button className="btn">Generate timeline</button>
        <p className="text-xs text-gray-500">
          Every task below is dated from this, so it is worth getting right.
        </p>
      </form>

      {plans.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {plans.map((p) => (
            <button
              key={p.id}
              className={selected === p.id ? 'btn' : 'btn-outline'}
              onClick={() => setSelected(p.id)}
            >
              {formatDate(p.weddingDate)}
            </button>
          ))}
        </div>
      )}

      {current && (
        <div className="card">
          <p className="text-sm text-gray-500">Wedding date</p>
          <p className="text-2xl font-semibold text-brand-dark">
            {formatDate(current.weddingDate)}
          </p>
          {hasDate(current.weddingDate) ? (
            <p className="text-sm text-gray-600">
              {away !== null && away > 0
                ? `${away} day${away === 1 ? '' : 's'} to go`
                : away === 0
                  ? 'Today.'
                  : 'This date has passed.'}
              {tasks.length > 0 ? ` · ${done} of ${tasks.length} tasks done` : ''}
            </p>
          ) : (
            <p className="text-sm text-amber-700">
              Set a date above and the timeline will build itself around it.
            </p>
          )}
        </div>
      )}

      {tasks.length > 0 && (
        <div className="card divide-y">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{t.title}</p>
                <p className="text-xs text-gray-500">
                  {t.category}
                  {' · '}
                  {hasDate(t.dueDate) ? (
                    <>
                      due {formatDate(t.dueDate)}
                      <span className="text-gray-400"> ({relativeToToday(t.dueDate)})</span>
                    </>
                  ) : (
                    <span className="text-gray-400">{NOT_SET}</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => cycleStatus(t)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
                  t.status === 'done'
                    ? 'bg-green-100 text-green-700'
                    : t.status === 'in_progress'
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-100 text-gray-600'
                }`}
              >
                {STATUS_LABEL[t.status] ?? t.status}
              </button>
            </div>
          ))}
        </div>
      )}

      {selected && tasks.length === 0 && (
        <p className="card text-sm text-gray-400">
          No tasks on this plan yet.
        </p>
      )}
    </div>
  );
}
