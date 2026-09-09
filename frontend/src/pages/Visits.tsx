import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Loading } from '../components/ui/Feedback';
import { VERIFICATION_LABEL, VerificationStatus } from '../lib/permissions';
import {
  Visit,
  VisitBucket,
  VISIT_TONE,
  countVisits,
  inBucket,
  scheduledLabel,
} from '../lib/visits';

/**
 * The officer's visits — every verification request allocated to them.
 *
 * The Verification page is the queue they act in; this is the schedule they
 * plan from. It reads the same officer-scoped endpoint and lays the requests
 * out as visits: headline counts to jump between, filters to narrow by, and a
 * structured list. Everything is derived on the client from the one list, so
 * there is no new entity or endpoint behind it.
 */

const STATUS_OPTIONS: VerificationStatus[] = [
  'assigned',
  'in_progress',
  'submitted',
  'admin_review',
  'additional_review',
  'approved',
  'rejected',
  'issue',
];

const TYPE_OPTIONS = ['agent', 'vendor', 'planner'];

const SUMMARY: { key: VisitBucket; label: string }[] = [
  { key: 'all', label: 'Total' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'today', label: 'Today' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default function Visits() {
  const [params] = useSearchParams();

  // The dashboard cards deep-link here: ?view=today opens the Today bucket,
  // ?status=assigned pre-selects that status.
  const [bucket, setBucket] = useState<VisitBucket>(
    params.get('view') === 'today' ? 'today' : 'all',
  );
  const [status, setStatus] = useState<string>(params.get('status') ?? '');
  const [type, setType] = useState('');
  const [city, setCity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

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
  const counts = useMemo(() => countVisits(visits), [visits]);

  // The cities actually present, so the filter offers real choices only.
  const cities = useMemo(
    () =>
      [...new Set(visits.map((v) => v.applicantCity).filter(Boolean) as string[])].sort((a, b) =>
        a.localeCompare(b),
      ),
    [visits],
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toTs = to ? new Date(`${to}T23:59:59`).getTime() : null;
    return visits
      .filter((v) => inBucket(v, bucket))
      .filter((v) => !status || v.status === status)
      .filter((v) => !type || v.applicantType === type)
      .filter((v) => !city || v.applicantCity === city)
      .filter((v) => {
        if (!fromTs && !toTs) return true;
        if (!v.slaDeadline) return false;
        const t = new Date(v.slaDeadline).getTime();
        if (fromTs && t < fromTs) return false;
        if (toTs && t > toTs) return false;
        return true;
      })
      .filter(
        (v) =>
          !q ||
          [v.subjectName, v.applicantEmail, v.applicantCity, v.applicantType, v.id]
            .filter(Boolean)
            .some((val) => String(val).toLowerCase().includes(q)),
      )
      .sort((a, b) => {
        // Scheduled first, soonest at the top; unscheduled fall to the end.
        const ta = a.slaDeadline ? new Date(a.slaDeadline).getTime() : Infinity;
        const tb = b.slaDeadline ? new Date(b.slaDeadline).getTime() : Infinity;
        return ta - tb;
      });
  }, [visits, bucket, status, type, city, from, to, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Visits</h1>
          <p className="page-subtitle">
            Every verification allocated to you, laid out as visits you can plan around.
          </p>
        </div>
        <Link className="btn-outline btn-sm" to="/calendar">
          Calendar view
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {SUMMARY.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setBucket(s.key)}
            className={`card text-left transition hover:border-brand hover:shadow-sm ${
              bucket === s.key ? 'border-brand ring-1 ring-brand' : ''
            }`}
          >
            <p className="text-xs uppercase tracking-wide text-gray-500">{s.label}</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-gray-900">
              {s.key === 'all'
                ? counts.total
                : s.key === 'upcoming'
                  ? counts.upcoming
                  : s.key === 'today'
                    ? counts.today
                    : s.key === 'completed'
                      ? counts.completed
                      : counts.cancelled}
            </p>
          </button>
        ))}
      </div>

      <div className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <input
          className="input lg:col-span-3"
          placeholder="Search — business, applicant, city, type or id"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="text-sm">
          <span className="text-gray-700">Status</span>
          <select className="input mt-1" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {VERIFICATION_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-gray-700">Type</span>
          <select className="input mt-1" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t} className="capitalize">
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-gray-700">City</span>
          <select className="input mt-1" value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-gray-700">Scheduled from</span>
          <input
            className="input mt-1"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="text-gray-700">Scheduled to</span>
          <input
            className="input mt-1"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>

      {isLoading ? (
        <Loading />
      ) : shown.length === 0 ? (
        <p className="card text-sm text-gray-500">
          {visits.length === 0 ? 'No visits allocated to you yet.' : 'Nothing matches those filters.'}
        </p>
      ) : (
        <div className="space-y-3">
          {shown.map((v) => (
            <VisitRow key={v.id} visit={v} />
          ))}
        </div>
      )}
    </div>
  );
}

function VisitRow({ visit }: { visit: Visit }) {
  const canStart = visit.status === 'assigned' || visit.status === 'additional_review';
  return (
    <div className="card flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium capitalize text-gray-900">
          {visit.applicantType} verification
          {visit.subjectName ? (
            <span className="text-gray-500"> — {visit.subjectName}</span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">
          {visit.applicantCity ?? 'Location not set'} · {scheduledLabel(visit.slaDeadline)}
        </p>
        {visit.applicantEmail && (
          <p className="text-xs text-gray-500">{visit.applicantEmail}</p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            VISIT_TONE[visit.status] ?? 'bg-gray-100 text-gray-600'
          }`}
        >
          {VERIFICATION_LABEL[visit.status] ?? visit.status.replace(/_/g, ' ')}
        </span>
        <Link className={canStart ? 'btn btn-sm' : 'btn-outline btn-sm'} to="/verification">
          {canStart ? 'Start' : 'View'}
        </Link>
      </div>
    </div>
  );
}
