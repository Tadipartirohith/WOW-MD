import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { api } from '../lib/api';
import { Loading } from '../components/ui/Feedback';
import { VERIFICATION_LABEL } from '../lib/permissions';
import { Visit, VISIT_TONE, isActive } from '../lib/visits';

/**
 * The officer's visits laid out by day.
 *
 * Same officer-scoped list as Visits and the Verification queue, arranged as a
 * month so a day's schedule reads at a glance. A visit sits on the day its
 * deadline falls; ones with no deadline are gathered underneath so they are not
 * lost. Selecting a day shows what is on it, with the way into each visit.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfMonthGrid(month: Date): Date {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  // Monday-based grid: JS getDay() is 0=Sun..6=Sat.
  const offset = (first.getDay() + 6) % 7;
  return new Date(first.getFullYear(), first.getMonth(), 1 - offset);
}

export default function Calendar() {
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<string>(ymd(today));

  const { data, isLoading } = useQuery({
    queryKey: ['officer-visits'],
    queryFn: async () =>
      (await api.get('/verification/requests', { params: { limit: 200 } })).data as {
        data: Visit[];
      },
    retry: false,
    refetchInterval: 30_000,
  });

  const visits = useMemo(() => data?.data ?? [], [data]);

  // Visits keyed by the day their deadline falls on.
  const byDay = useMemo(() => {
    const map = new Map<string, Visit[]>();
    for (const v of visits) {
      if (!v.slaDeadline) continue;
      const d = new Date(v.slaDeadline);
      if (Number.isNaN(d.getTime())) continue;
      const key = ymd(d);
      const list = map.get(key) ?? [];
      list.push(v);
      map.set(key, list);
    }
    return map;
  }, [visits]);

  const unscheduled = useMemo(
    () => visits.filter((v) => !v.slaDeadline && isActive(v)),
    [visits],
  );

  const cells = useMemo(() => {
    const start = startOfMonthGrid(month);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return d;
    });
  }, [month]);

  const selectedVisits = byDay.get(selected) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Calendar</h1>
        <p className="page-subtitle">Your visits by day, so the schedule reads at a glance.</p>
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            className="btn-outline btn-sm"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            aria-label="Previous month"
          >
            <CaretLeft size={16} aria-hidden />
          </button>
          <h2 className="section-title">
            {month.toLocaleDateString([], { month: 'long', year: 'numeric' })}
          </h2>
          <button
            type="button"
            className="btn-outline btn-sm"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            aria-label="Next month"
          >
            <CaretRight size={16} aria-hidden />
          </button>
        </div>

        {isLoading ? (
          <Loading />
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-gray-500">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((d) => {
                const key = ymd(d);
                const inMonth = d.getMonth() === month.getMonth();
                const isToday = key === ymd(today);
                const isSelected = key === selected;
                const dayVisits = byDay.get(key) ?? [];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelected(key)}
                    className={`min-h-[4.5rem] rounded-md border p-1 text-left align-top transition ${
                      isSelected
                        ? 'border-brand ring-1 ring-brand'
                        : 'border-gray-200 hover:border-gray-300'
                    } ${inMonth ? 'bg-surface' : 'bg-surface-sunken text-gray-400'}`}
                  >
                    <span
                      className={`text-xs ${
                        isToday
                          ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-brand-fg'
                          : inMonth
                            ? 'text-gray-700'
                            : 'text-gray-400'
                      }`}
                    >
                      {d.getDate()}
                    </span>
                    <div className="mt-1 space-y-0.5">
                      {dayVisits.slice(0, 3).map((v) => (
                        <div
                          key={v.id}
                          className={`truncate rounded px-1 py-0.5 text-[0.65rem] ${
                            VISIT_TONE[v.status] ?? 'bg-gray-100 text-gray-600'
                          }`}
                          title={`${v.applicantType}${v.subjectName ? ` — ${v.subjectName}` : ''}`}
                        >
                          {v.subjectName ?? v.applicantType}
                        </div>
                      ))}
                      {dayVisits.length > 3 && (
                        <div className="px-1 text-[0.65rem] text-gray-500">
                          +{dayVisits.length - 3} more
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="card space-y-3">
        <h2 className="section-title">
          {new Date(
            Number(selected.split('-')[0]),
            Number(selected.split('-')[1]),
            Number(selected.split('-')[2]),
          ).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
        </h2>
        {selectedVisits.length === 0 ? (
          <p className="text-sm text-gray-500">No visits scheduled for this day.</p>
        ) : (
          selectedVisits.map((v) => <DayVisit key={v.id} visit={v} />)
        )}
      </div>

      {unscheduled.length > 0 && (
        <div className="card space-y-3">
          <div>
            <h2 className="section-title">Unscheduled</h2>
            <p className="text-sm text-gray-600">
              Open visits without a deadline yet — worth slotting in.
            </p>
          </div>
          {unscheduled.map((v) => (
            <DayVisit key={v.id} visit={v} />
          ))}
        </div>
      )}
    </div>
  );
}

function DayVisit({ visit }: { visit: Visit }) {
  const time = visit.slaDeadline
    ? new Date(visit.slaDeadline).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
      <div className="min-w-0">
        <p className="font-medium capitalize text-gray-900">
          {visit.applicantType} verification
          {visit.subjectName ? <span className="text-gray-500"> — {visit.subjectName}</span> : null}
        </p>
        <p className="text-xs text-gray-500">
          {time ? `${time} · ` : ''}
          {visit.applicantCity ?? 'Location not set'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            VISIT_TONE[visit.status] ?? 'bg-gray-100 text-gray-600'
          }`}
        >
          {VERIFICATION_LABEL[visit.status] ?? visit.status.replace(/_/g, ' ')}
        </span>
        <Link className="btn-outline btn-sm" to="/verification">
          Open
        </Link>
      </div>
    </div>
  );
}
