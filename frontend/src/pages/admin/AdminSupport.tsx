import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../../lib/api';
import { useAuth } from '../../store/auth';
import { CaseStatus, Permission, can } from '../../lib/permissions';
import {
  CASE_FILTERS,
  CaseRow,
  type Officer,
  type SupportCase,
} from '../Verification';

/**
 * The admin Support inbox: support/dispute cases, relocated here from the
 * Verification screen (EZ1-I203).
 *
 * A Verification Officer still works cases on their own Verification screen;
 * this is the administrator's view of the same cases, reusing the same
 * `/verification/cases` endpoints and the same `CaseRow` — so opening a case
 * keeps the identical workflow (details, evidence, assigned officer, history,
 * officer findings, recommended resolution, and the admin decision). Nothing
 * here forks the case model.
 */
export default function AdminSupport() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const canAllocate = can(permissions, Permission.VERIFICATION_ALLOCATE);
  const canManageOfficers = can(permissions, Permission.ADMIN_OFFICER_MANAGE);

  const [caseFilter, setCaseFilter] = useState<CaseStatus | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  /*
   * Which half of Support you are looking at, held in the URL.
   *
   * Cases and disputes are separate entities on the server -- separate tables,
   * separate endpoints, separate resolution paths -- so they stay separate here
   * rather than being merged into one list (EZ1-I222). Keeping the choice in the
   * query string is what lets the dashboard's two tiles land on the right one,
   * instead of both dropping the administrator on Verification, which owns
   * neither.
   */
  const [params, setParams] = useSearchParams();
  const tab: 'cases' | 'disputes' = params.get('tab') === 'disputes' ? 'disputes' : 'cases';
  const setTab = (next: 'cases' | 'disputes') => {
    const copy = new URLSearchParams(params);
    copy.set('tab', next);
    setParams(copy, { replace: true });
  };

  const { data: disputes = [] } = useQuery({
    queryKey: ['admin-disputes'],
    queryFn: async () => (await api.get('/admin/disputes')).data as Dispute[],
    retry: false,
    enabled: tab === 'disputes',
  });

  const { data: cases } = useQuery({
    queryKey: ['verification-cases'],
    queryFn: async () => (await api.get('/verification/cases')).data,
    retry: false,
    refetchInterval: 20_000,
  });

  const { data: officers } = useQuery({
    queryKey: ['verification-officers'],
    queryFn: async () => (await api.get('/verification/officers')).data as Officer[],
    retry: false,
    enabled: canManageOfficers,
  });

  const { data: workload = [] } = useQuery({
    queryKey: ['verification-workload'],
    queryFn: async () =>
      (await api.get('/verification/workload')).data as {
        officerUserId: string;
        open: number;
        onLeave?: boolean;
        availability?: { status: string; leaveTo: string | null };
      }[],
    retry: false,
    enabled: canAllocate,
  });

  // Same shape as the Verification screen's roster, and for the same reason:
  // an officer who is away is shown, marked, and not selectable (EZ1-I221).
  const officersWithLoad: Officer[] = (officers ?? []).map((o) => {
    const load = workload.find((w) => w.officerUserId === o.id);
    return {
      ...o,
      openCount: load?.open ?? 0,
      onLeave: load?.onLeave ?? false,
      availabilityStatus: load?.availability?.status,
      leaveTo: load?.availability?.leaveTo ?? null,
    };
  });
  const activeOfficers = officersWithLoad
    .filter((o) => o.isActive)
    .sort((a, b) => (a.openCount ?? 0) - (b.openCount ?? 0));

  async function run(fn: () => Promise<unknown>, done?: string) {
    setError('');
    setNotice('');
    try {
      await fn();
      if (done) setNotice(done);
      qc.invalidateQueries({ queryKey: ['verification-cases'] });
      qc.invalidateQueries({ queryKey: ['verification-metrics'] });
      qc.invalidateQueries({ queryKey: ['verification-officers'] });
      qc.invalidateQueries({ queryKey: ['admin-disputes'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
    } catch (err) {
      setError(apiMessage(err, 'That action was rejected.'));
    }
  }

  const caseRows: SupportCase[] = cases?.data ?? [];
  const shown = caseFilter ? caseRows.filter((c) => c.status === caseFilter) : caseRows;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Support</h1>
        <p className="page-subtitle">
          Disputes and support cases raised across the platform. Each keeps the full
          investigation — parties, evidence, the assigned officer's findings and the
          resolution you approve.
        </p>
      </div>

      {error && <p className="alert-critical">{error}</p>}
      {notice && <p className="alert-positive">{notice}</p>}

      <div className="flex gap-1 border-b border-gray-200">
        {(['cases', 'disputes'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-current={tab === key ? 'page' : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              tab === key
                ? 'border-brand font-medium text-brand-strong'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {key === 'cases' ? 'Cases' : 'Disputes'}
          </button>
        ))}
      </div>

      {tab === 'disputes' ? (
        <DisputesPanel disputes={disputes} onRun={run} />
      ) : (
        <>
          {/*
            Case status cards with live counts, in the order work moves. Clicking
            one filters the list; clicking it again clears the filter.
          */}
          <div className="flex flex-wrap gap-2">
        {CASE_FILTERS.map((f) => {
          const count = caseRows.filter((c) => c.status === f.key).length;
          return (
            <button
              key={f.key}
              onClick={() => setCaseFilter(f.key === caseFilter ? null : f.key)}
              className={`rounded-full border px-3 py-1 text-xs ${
                f.key === caseFilter
                  ? 'border-brand bg-brand text-brand-fg'
                  : count > 0
                    ? 'border-gray-300 text-gray-700 hover:border-brand'
                    : 'border-gray-200 text-gray-400'
              }`}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        {caseRows.length === 0 ? (
          <p className="card text-sm text-gray-500">No cases.</p>
        ) : shown.length === 0 ? (
          <p className="card text-sm text-gray-500">Nothing in that group.</p>
        ) : (
          shown.map((c) => (
            <CaseRow
              key={c.id}
              item={c}
              officers={activeOfficers}
              canAllocate={canAllocate}
              onRun={run}
            />
          ))
        )}
          </div>
        </>
      )}
    </div>
  );
}

/** A dispute as the admin list needs it: the money, the person, the reason. */
interface Dispute {
  id: string;
  reason: string;
  status: 'open' | 'resolved' | 'rejected';
  resolution: string | null;
  createdAt: string;
  raisedByName: string;
  raisedByRole: string | null;
  booking: {
    id: string;
    status: string;
    amount: string;
    currency: string;
    providerType: string;
    eventDate: string | null;
  } | null;
}

const DISPUTE_TONE: Record<Dispute['status'], string> = {
  open: 'bg-caution-bg text-caution-fg',
  resolved: 'bg-positive-bg text-positive-fg',
  rejected: 'bg-critical-bg text-critical-fg',
};

/**
 * Disputes raised against bookings.
 *
 * The endpoint and the resolve action have existed since disputes were built;
 * nothing ever rendered them. So the dashboard counted eight open disputes and
 * clicking that tile went to Verification, which does not hold a single one
 * (EZ1-I222). Deciding one asks for a note first, because a rejection with no
 * reason is not an answer either party can act on.
 */
function DisputesPanel({
  disputes,
  onRun,
}: {
  disputes: Dispute[];
  onRun: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');

  const openCount = disputes.filter((d) => d.status === 'open').length;

  if (disputes.length === 0) {
    return <p className="card text-sm text-gray-500">No disputes have been raised.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        {openCount} open of {disputes.length}. A disputed booking keeps its money in escrow until
        this is decided.
      </p>

      {disputes.map((d) => (
        <div key={d.id} className="card space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800">
                {d.booking
                  ? `${d.booking.currency} ${Number(d.booking.amount).toLocaleString('en-IN')} · ${d.booking.providerType}`
                  : 'Booking no longer available'}
              </p>
              <p className="text-xs text-gray-500">
                Raised by {d.raisedByName}
                {d.raisedByRole ? ` (${d.raisedByRole})` : ''} on{' '}
                {new Date(d.createdAt).toLocaleDateString()}
                {d.booking?.eventDate ? ` · event ${d.booking.eventDate}` : ''}
              </p>
            </div>
            <span className={`rounded-full px-2 py-1 text-xs ${DISPUTE_TONE[d.status]}`}>
              {d.status}
            </span>
          </div>

          <p className="whitespace-pre-wrap text-sm text-gray-700">{d.reason}</p>

          {d.resolution && (
            <p className="rounded-sm bg-surface-sunken p-2 text-sm text-gray-700">
              <span className="font-medium">Resolution:</span> {d.resolution}
            </p>
          )}

          {d.status === 'open' &&
            (openId === d.id ? (
              <div className="space-y-2 border-t pt-2">
                <label className="label" htmlFor={`res-${d.id}`}>
                  What was decided, and why
                </label>
                <textarea
                  id={`res-${d.id}`}
                  className="input"
                  rows={2}
                  maxLength={2000}
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-sm"
                    disabled={resolution.trim().length < 3}
                    onClick={async () => {
                      await onRun(
                        () =>
                          api.put(`/admin/disputes/${d.id}/resolve`, {
                            status: 'resolved',
                            resolution: resolution.trim(),
                          }),
                        'Dispute resolved.',
                      );
                      setOpenId(null);
                      setResolution('');
                    }}
                  >
                    Uphold and resolve
                  </button>
                  <button
                    className="btn-outline btn-sm"
                    disabled={resolution.trim().length < 3}
                    onClick={async () => {
                      await onRun(
                        () =>
                          api.put(`/admin/disputes/${d.id}/resolve`, {
                            status: 'rejected',
                            resolution: resolution.trim(),
                          }),
                        'Dispute rejected.',
                      );
                      setOpenId(null);
                      setResolution('');
                    }}
                  >
                    Reject
                  </button>
                  <button className="btn-ghost btn-sm" onClick={() => setOpenId(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="btn-outline btn-sm"
                onClick={() => {
                  setOpenId(d.id);
                  setResolution('');
                }}
              >
                Decide this
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}
