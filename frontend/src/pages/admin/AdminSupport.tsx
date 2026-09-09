import { useState } from 'react';
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
      }[],
    retry: false,
    enabled: canAllocate,
  });

  const officersWithLoad: Officer[] = (officers ?? []).map((o) => ({
    ...o,
    openCount: workload.find((w) => w.officerUserId === o.id)?.open ?? 0,
  }));
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

      {/*
        Case status cards with live counts, in the order work moves. Clicking one
        filters the list; clicking it again clears the filter.
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
    </div>
  );
}
