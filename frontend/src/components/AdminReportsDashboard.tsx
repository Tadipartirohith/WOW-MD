import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DownloadSimple } from '@phosphor-icons/react';
import {
  BOOKING_STATUS_LABEL,
  CASE_STATUS_LABEL,
  ROLE_LABEL,
  VERIFICATION_LABEL,
  type UserRole,
  type VerificationStatus,
} from '../lib/permissions';
import OverviewTab from './reports/OverviewTab';
import { BookingsTab, RevenueTab } from './reports/BookingsRevenueTabs';
import { ProvidersTab, UsersTab } from './reports/PeopleTabs';
import { PaymentsTab, SupportTab, VerificationTab } from './reports/OperationsTabs';
import {
  APPLICANT_LABEL,
  CASE_SUBJECT_LABEL,
  DISPUTE_STATUS_LABEL,
  MILESTONE_LABEL,
  PAYMENT_STATUS_LABEL,
  PRESETS,
  downloadCsv,
  presetWindow,
  titleCase,
  useActivity,
  useReport,
  useSeries,
  type BookingsReport,
  type CategoriesReport,
  type CsvRow,
  type FinancialReport,
  type PaymentsReport,
  type ProviderRow,
  type RangeKey,
  type ReportWindow,
  type ReportsData,
  type SupportReport,
  type UsersReport,
  type VerificationReport,
} from './reports/reportData';

/*
 * Admin Reports (EZ1-I242).
 *
 * The page resolves one window -- a preset or a custom range -- and every
 * section reads that same window, so no figure can describe a different period
 * from the one beside it. The window and the tab live in the URL: a drill-down
 * and the back button return to exactly what was on screen, and a report can
 * be sent to a colleague as a link.
 */

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'users', label: 'Users' },
  { key: 'providers', label: 'Vendors & Planners' },
  { key: 'payments', label: 'Payments' },
  { key: 'verification', label: 'Verification' },
  { key: 'support', label: 'Support' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const isDay = (s: string | null): s is string =>
  Boolean(s) && /^\d{4}-\d{2}-\d{2}$/.test(s as string) && !Number.isNaN(new Date(s as string).getTime());

const longDay = (s: string) =>
  new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function AdminReportsDashboard() {
  const [params, setParams] = useSearchParams();

  const tabParam = params.get('tab');
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : 'overview';
  const rangeParam = params.get('range');
  const range: RangeKey =
    rangeParam === 'custom' || PRESETS.some((p) => p.key === rangeParam) ? (rangeParam as RangeKey) : '30d';
  const fromParam = params.get('from');
  const toParam = params.get('to');

  const w: ReportWindow = useMemo(() => {
    if (range === 'custom' && isDay(fromParam) && isDay(toParam)) return { from: fromParam, to: toParam };
    return presetWindow(range === 'custom' ? '30d' : range);
  }, [range, fromParam, toParam]);

  const [draft, setDraft] = useState<ReportWindow>(w);
  const [draftError, setDraftError] = useState('');
  useEffect(() => setDraft(w), [w]);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const today = presetWindow('today').to;

  function applyCustom() {
    if (!isDay(draft.from) || !isDay(draft.to)) return setDraftError('Choose both a start and an end date.');
    if (draft.from > draft.to) return setDraftError('The start date has to be on or before the end date.');
    if (draft.to > today) return setDraftError('The end date cannot be in the future.');
    setDraftError('');
    update({ range: 'custom', from: draft.from, to: draft.to });
  }

  function choosePreset(key: Exclude<RangeKey, 'custom'>) {
    setDraftError('');
    update({ range: key, from: null, to: null });
  }

  const d: ReportsData = {
    window: w,
    users: useReport<UsersReport>('users', w),
    bookings: useReport<BookingsReport>('bookings', w),
    financial: useReport<FinancialReport>('financial', w),
    payments: useReport<PaymentsReport>('payments', w),
    providers: useReport<{ rows: ProviderRow[] }>('providers', w),
    categories: useReport<CategoriesReport>('categories', w),
    support: useReport<SupportReport>('support', w),
    verification: useReport<VerificationReport>('verification', w),
    series: useSeries(w),
    activity: useActivity(w, 50),
  };

  const tabLabel = TABS.find((t) => t.key === tab)!.label;
  const [exportError, setExportError] = useState('');

  function exportCsv() {
    const rows = csvFor(tab, d);
    if (!rows) {
      setExportError('Some figures on this tab are still loading or could not be loaded. Retry them before exporting.');
      return;
    }
    setExportError('');
    downloadCsv(`wow-${tab}-${w.from}_to_${w.to}.csv`, [
      ['WOW Reports', tabLabel],
      ['Period', w.from, 'to', w.to],
      ['Generated', new Date().toISOString()],
      [],
      ...rows,
    ]);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Reports &amp; Analytics</h1>
          <p className="page-subtitle">
            {w.from === w.to ? longDay(w.from) : `${longDay(w.from)} to ${longDay(w.to)}`}. Every figure is a
            live read of the platform's own records.
          </p>
        </div>
        <button className="btn inline-flex items-center gap-2" onClick={exportCsv}>
          <DownloadSimple size={18} weight="bold" aria-hidden />
          Export {tabLabel} (CSV)
        </button>
      </header>
      {exportError && <p className="alert-critical">{exportError}</p>}

      <div className="card flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Report period">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              aria-pressed={range === p.key}
              onClick={() => choosePreset(p.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                range === p.key
                  ? 'bg-brand text-brand-fg shadow-card'
                  : 'bg-surface-sunken text-gray-600 hover:bg-brand-soft hover:text-brand-strong'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-gray-600">
            From
            <input type="date" className="input mt-1 block" value={draft.from} max={draft.to || today}
              onChange={(e) => setDraft((x) => ({ ...x, from: e.target.value }))} />
          </label>
          <label className="text-xs font-medium text-gray-600">
            To
            <input type="date" className="input mt-1 block" value={draft.to} min={draft.from} max={today}
              onChange={(e) => setDraft((x) => ({ ...x, to: e.target.value }))} />
          </label>
          <button className={range === 'custom' ? 'btn' : 'btn-outline'} onClick={applyCustom}>
            Apply
          </button>
          <button className="btn-outline" onClick={() => choosePreset('30d')}>
            Reset
          </button>
        </div>
        {draftError && <p className="w-full text-sm text-critical-fg">{draftError}</p>}
      </div>

      <div className="-mx-1 overflow-x-auto">
        <div role="tablist" aria-label="Report" className="flex min-w-max gap-1 border-b border-gray-200 px-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => update({ tab: t.key })}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-brand text-brand-strong'
                  : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" aria-label={tabLabel}>
        {tab === 'overview' && <OverviewTab d={d} />}
        {tab === 'bookings' && <BookingsTab d={d} />}
        {tab === 'revenue' && <RevenueTab d={d} />}
        {tab === 'users' && <UsersTab d={d} />}
        {tab === 'providers' && <ProvidersTab d={d} />}
        {tab === 'payments' && <PaymentsTab d={d} />}
        {tab === 'verification' && <VerificationTab d={d} />}
        {tab === 'support' && <SupportTab d={d} />}
      </div>
    </div>
  );
}

/**
 * The rows behind the tab on screen, or null when any of them is not loaded --
 * an export with a silently missing section reads as a period where nothing
 * happened.
 */
function csvFor(tab: TabKey, d: ReportsData): CsvRow[] | null {
  const need = (...qs: { data?: unknown; isSuccess: boolean }[]) => qs.every((q) => q.isSuccess && q.data);
  const out: CsvRow[] = [];
  const section = (title: string, rows: CsvRow[]) => out.push([title], ...rows, []);

  const u = d.users.data;
  const b = d.bookings.data;
  const f = d.financial.data;
  const p = d.payments.data;
  const s = d.support.data;
  const v = d.verification.data;
  const points = d.series.data?.points ?? [];

  const stageRows = (): CsvRow[] =>
    Object.entries(BOOKING_STATUS_LABEL).map(([k, label]) => [label, b?.byStatus[k] ?? 0]);
  const financialRows = (): CsvRow[] => [
    ['Collected', f!.collected],
    ['Released to providers', f!.releasedToProviders],
    ['Platform commission', f!.commission],
    ['Held in escrow', f!.held],
    ['Awaiting payout', f!.awaitingPayout],
    ['Disputed', f!.disputed],
    ['Refunded', f!.refunded],
  ];

  switch (tab) {
    case 'overview':
      if (!need(d.users, d.bookings, d.financial, d.support, d.verification)) return null;
      section('In this period', [
        ['New individual users', u!.individuals],
        ['New bookings', b!.placed],
        ['Booking value (INR, cancelled excluded)', b!.grossValue],
        ['Revenue collected (INR)', f!.collected],
        ['Completed bookings', b!.byStatus.completed],
        ['Cancelled bookings', b!.byStatus.cancelled],
        ['Open support cases', s!.open],
        ['Open disputes', s!.openDisputes],
        ['Pending verification', v!.pending],
      ]);
      section('The platform, all time', [
        ['Vendors', u!.platform.vendors],
        ['Wedding planners', u!.platform.planners],
        ['Agencies', u!.platform.agents],
        ['Verification officers (active)', u!.platform.officers],
      ]);
      section('Bookings by stage', stageRows());
      section('Money (INR)', financialRows());
      return out;

    case 'bookings':
      if (!need(d.bookings, d.series, d.categories)) return null;
      section('Summary', [
        ['New bookings', b!.placed],
        ['Booking value (INR, cancelled excluded)', b!.grossValue],
        ['Average booking (INR)', b!.averageValue],
      ]);
      section('Bookings by stage', stageRows());
      section('Bookings by category', [
        ['Category', 'Bookings', 'Completed', 'Value (INR)'],
        ...d.categories.data!.rows.map((r) => [r.category, r.bookings, r.completed, r.value]),
      ]);
      section('Per day', [['Date', 'Bookings', 'Value (INR)'], ...points.map((x) => [x.date, x.bookings, x.value])]);
      return out;

    case 'revenue':
      if (!need(d.financial, d.series, d.payments)) return null;
      section('Money (INR)', financialRows());
      section('By instalment', [
        ['Instalment', 'Payments', 'Amount (INR)'],
        ...Object.entries(p!.byMilestone).map(([m, x]) => [MILESTONE_LABEL[m] ?? m, x.count, x.amount]),
      ]);
      section('Per day', [
        ['Date', 'Collected (INR)', 'Commission (INR)', 'Booking value (INR)'],
        ...points.map((x) => [x.date, x.collected, x.commission, x.value]),
      ]);
      return out;

    case 'users':
      if (!need(d.users, d.series)) return null;
      section('Summary', [
        ['New individual users', u!.individuals],
        ['New accounts, every role', u!.total],
      ]);
      section('New accounts by role', Object.entries(u!.byRole).map(([r, n]) => [ROLE_LABEL[r as UserRole] ?? r, n]));
      section('Per day', [['Date', 'Individual users', 'All accounts'], ...points.map((x) => [x.date, x.individuals, x.users])]);
      return out;

    case 'providers':
      if (!need(d.providers)) return null;
      section('Provider performance', [
        ['Provider', 'Type', 'Category', 'City', 'Bookings', 'Completed', 'Cancelled', 'Completion %', 'Cancellation %', 'Value (INR)', 'Collected (INR)', 'Rating', 'Reviews'],
        ...d.providers.data!.rows.map((r) => [
          r.name, r.providerType, r.category, r.city, r.bookings, r.completed, r.cancelled,
          r.completionRate, r.cancellationRate, r.value, r.collected, r.rating, r.ratingCount,
        ]),
      ]);
      return out;

    case 'payments':
      if (!need(d.payments)) return null;
      section('Summary', [
        ['Transactions', p!.transactions],
        ['Successful', p!.successful],
        ['Not yet paid', p!.pending],
        ['Failed', p!.failed],
        ['Refunded', p!.refunded],
        ['Disputed', p!.disputed],
      ]);
      section('By status', [
        ['Status', 'Payments', 'Amount (INR)'],
        ...Object.entries(p!.byStatus).map(([k, x]) => [PAYMENT_STATUS_LABEL[k] ?? titleCase(k), x.count, x.amount]),
      ]);
      section('Amounts (INR)', Object.entries(p!.amounts).map(([k, x]) => [titleCase(k.replace(/([A-Z])/g, '_$1')), x]));
      return out;

    case 'verification':
      if (!need(d.verification)) return null;
      section('Summary', [
        ['Requests', v!.requests],
        ['Waiting for an officer', v!.pending],
        ['In progress', v!.inFlight],
        ['Approved', v!.approved],
        ['Rejected', v!.rejected],
        ['Median hours to a decision', v!.medianHoursToDecision],
      ]);
      section('By status', Object.entries(v!.byStatus).map(([k, n]) => [VERIFICATION_LABEL[k as VerificationStatus] ?? k, n]));
      section('By applicant', [
        ['Applicant', 'Requests', 'Approved', 'Rejected', 'Still open'],
        ...Object.entries(v!.byApplicantType).map(([t, x]) => [APPLICANT_LABEL[t] ?? t, x.requests, x.approved, x.rejected, x.pending]),
      ]);
      section('Officer workload (open now)', [['Officer', 'Open requests'], ...v!.officerWorkload.map((o) => [o.email, o.open])]);
      return out;

    case 'support':
      if (!need(d.support)) return null;
      section('Summary', [
        ['Cases raised', s!.cases],
        ['Open cases', s!.open],
        ['Not yet resolved', s!.unresolved],
        ['Escalated', s!.escalated],
        ['Median hours to resolution', s!.medianHoursToResolution],
        ['Disputes raised', s!.disputes],
        ['Open disputes', s!.openDisputes],
      ]);
      section('Cases by status', Object.entries(s!.caseByStatus).map(([k, n]) => [CASE_STATUS_LABEL[k] ?? titleCase(k), n]));
      section('Cases by subject', Object.entries(s!.bySubject).map(([k, n]) => [CASE_SUBJECT_LABEL[k] ?? k, n]));
      section('Disputes by status', Object.entries(s!.disputeByStatus).map(([k, n]) => [DISPUTE_STATUS_LABEL[k] ?? k, n]));
      return out;
  }
}
