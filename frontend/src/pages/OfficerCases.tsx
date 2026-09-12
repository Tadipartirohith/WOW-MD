import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { CaseStatus, Permission, can } from '../lib/permissions';
import { CASE_FILTERS, CaseRow, type Officer, type SupportCase } from './Verification';

/**
 * The cases assigned to a verification officer, on their own page.
 *
 * These lived as a tab inside Verification, beside the visit queue. The two are
 * different work — a visit is "go to this address and write down what you saw",
 * a case is an investigation with parties, evidence and a resolution — and
 * sharing a screen meant an officer filtering one was also filtering away the
 * other (EZ1-I219).
 *
 * Same endpoints and the same `CaseRow` the admin Support page uses, so opening
 * a case keeps the identical workflow. Nothing here forks the case model, and
 * no case record is created or duplicated by the move.
 */
export default function OfficerCases() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const canAllocate = can(permissions, Permission.VERIFICATION_ALLOCATE);

  const [caseFilter, setCaseFilter] = useState<CaseStatus | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  /*
   * The list asked for one default page -- the newest twenty -- and each chip
   * counted inside that page, so an officer with more than twenty cases saw
   * counts that were short and could not reach the older cases at all. The
   * admin Support inbox had the same fault (EZ1-I242).
   *
   * The server filters by status now, and the chips read the server's own
   * per-status counts for this officer.
   */
  const { data: cases } = useQuery({
    queryKey: ['verification-cases', caseFilter],
    queryFn: async () =>
      (
        await api.get('/verification/cases', {
          params: { limit: 100, status: caseFilter ?? undefined },
        })
      ).data,
    retry: false,
    refetchInterval: 20_000,
  });

  const { data: metrics } = useQuery({
    queryKey: ['verification-metrics'],
    queryFn: async () => (await api.get('/verification/metrics')).data,
    retry: false,
    refetchInterval: 20_000,
  });
  const caseCounts: Record<string, number> | undefined = metrics?.cases;

  // Only an allocator needs the roster; an officer working their own cases
  // never reassigns one, so the request is not made for them.
  const { data: officers } = useQuery({
    queryKey: ['verification-officers'],
    queryFn: async () => (await api.get('/verification/officers')).data as Officer[],
    retry: false,
    enabled: canAllocate,
  });

  async function run(fn: () => Promise<unknown>, done?: string) {
    setError('');
    setNotice('');
    try {
      await fn();
      if (done) setNotice(done);
      qc.invalidateQueries({ queryKey: ['verification-cases'] });
      qc.invalidateQueries({ queryKey: ['verification-metrics'] });
    } catch (err) {
      setError(apiMessage(err, 'That action was rejected.'));
    }
  }

  const caseRows: SupportCase[] = cases?.data ?? [];
  // Already filtered by the server; nothing to narrow here.
  const shown = caseRows;
  const totalCases: number = cases?.meta?.total ?? caseRows.length;
  const activeOfficers = (officers ?? []).filter((o) => o.isActive);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Cases</h1>
        <p className="page-subtitle">
          Investigations allocated to you — who raised it, what the evidence says, and the
          resolution you propose. Verification visits are on their own page.
        </p>
      </div>

      {error && <p className="alert-critical">{error}</p>}
      {notice && <p className="alert-positive">{notice}</p>}

      {/* Every status is its own filter with a live count, so an officer can go
          straight to what is escalated rather than reading one long list. */}
      <div className="flex flex-wrap gap-2">
        {CASE_FILTERS.map((f) => {
          // Falls back to the loaded rows only if the counts could not be read.
          const count = caseCounts
            ? (caseCounts[f.key] ?? 0)
            : caseRows.filter((c) => c.status === f.key).length;
          return (
            <button
              key={f.key}
              onClick={() => setCaseFilter(f.key === caseFilter ? null : f.key)}
              aria-pressed={f.key === caseFilter}
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
        {shown.length > 0 && totalCases > shown.length && (
          <p className="text-xs text-gray-500">
            Showing the newest {shown.length} of {totalCases}
            {caseFilter ? ' in this group' : ''}.
          </p>
        )}
        {shown.length === 0 ? (
          <p className="card text-sm text-gray-500">
            {caseFilter ? 'Nothing in that group.' : 'Nothing allocated to you.'}
          </p>
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
    </div>
  );
}
