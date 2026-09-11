import { ReactNode, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { Loading } from '../components/ui/Feedback';
import {
  CASE_ACTION_LABEL,
  CORRECTABLE_FIELD_KEYS,
  CORRECTION_FIELD_LABELS,
  CaseStatus,
  MILESTONE_LABEL,
  Permission,
  VERIFICATION_LABEL,
  VerificationStatus,
  can,
} from '../lib/permissions';

/** What an officer wrote up after attending. */
interface VerificationFindings {
  visited: boolean;
  observations: string;
  issues: string[];
  evidence: string[];
  recommendation: 'approve' | 'reject' | 'revisit';
}

interface VerificationRequest {
  id: string;
  applicantType: string;
  applicantUserId: string;
  subjectId: string | null;
  status: VerificationStatus;
  assignedToUserId: string | null;
  remarks: string | null;
  createdAt: string;
  findings: VerificationFindings | null;
  /** When the officer filed the findings, for the submitted card (EZ1-I26). */
  submittedAt?: string | null;
  revisitCount: number;
  /** What the automatic allocation went on. Absent on an older request. */
  allocationBasis?: string | null;
  applicantCity?: string | null;
  /** Filled in by the queue so a card can say who it is about. */
  applicantEmail?: string | null;
  applicantPhone?: string | null;
  subjectName?: string | null;
  /** The 72-hour clock. Computed and stored on the server since the schema was written. */
  slaDeadline?: string | null;
  slaBreachedAt?: string | null;
  verificationStartedAt?: string | null;
}

export interface SupportCase {
  id: string;
  subjectType: string;
  subjectId: string | null;
  title: string;
  description: string;
  status: CaseStatus;
  assignedToUserId: string | null;
  findings: string | null;
  settlementOutcome: string | null;
  settlementNotes?: string | null;
  /** The category-specific action the officer resolved with (EZ1-I181). */
  resolutionAction?: string | null;
  /** Which instalment the argument is over; null when it is not about money. */
  milestone: string | null;
  evidence: string[];
  requiresPhysicalVerification: boolean;
  createdAt: string;
  /** Investigation context filled in on read (EZ1-I74). */
  raisedByUserId?: string | null;
  raisedByName?: string | null;
  raisedByEmail?: string | null;
  raisedByRole?: string | null;
  booking?: {
    id: string;
    status: string;
    amount: string;
    currency: string;
    buyerName: string | null;
    providerName: string | null;
  } | null;
  /** Case-type-specific investigation context (EZ1-I149). */
  payments?: {
    milestone: string;
    status: string;
    amount: string;
    payoutAmount: string;
    payoutNote: string | null;
  }[] | null;
  business?: {
    id: string;
    name: string;
    category: string;
    city: string | null;
    status: string;
    isApproved: boolean;
    gstNumber: string | null;
    panNumber: string | null;
    tradingSince: string | null;
    verifiedAt: string | null;
    decisionReason: string | null;
    revisionCount: number;
  } | null;
  account?: {
    email: string | null;
    role: string | null;
    isActive: boolean;
  } | null;
  availability?: {
    upcoming: number;
    conflicts: number;
    slots: {
      date: string;
      startTime: string;
      endTime: string;
      capacity: number;
      confirmed: number;
      pending: number;
      status: string;
    }[];
  } | null;
}

export interface Officer {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  /** Open cases already on their plate, so allocation is an informed choice. */
  openCount?: number;
  /**
   * Staff, or an agency doing fieldwork.
   *
   * Kept apart in the picker rather than merged into one list: sending a
   * commercial participant to inspect a business is a different decision from
   * sending an officer, and the person allocating should see which one they
   * are making. The server refuses the conflicted combinations regardless.
   */
  kind?: 'officer' | 'agent';
  /**
   * Out of allocation right now -- on leave inside its window, or stood down.
   *
   * Reported by the workload endpoint all along and never read here, so the
   * dropdown offered officers who were away and the allocation went through
   * (EZ1-I221). They stay listed, marked and disabled, rather than vanishing:
   * an administrator looking for somebody needs to see *why* they cannot pick
   * them, or they go hunting for a name that is simply missing.
   */
  onLeave?: boolean;
  /** `available` | `on_leave` | `unavailable`, for the label beside the name. */
  availabilityStatus?: string;
  /** Last day of the leave window, when there is one. */
  leaveTo?: string | null;
}

/**
 * Who to send this to.
 *
 * Two lists in one control, because the roster now holds officers and the
 * agents who do fieldwork, and running them together would hide the only thing
 * that distinguishes them. The pool filter defaults to Everyone: an
 * administrator clearing a queue wants the whole bench, and narrowing to one
 * kind is the exception rather than the first decision.
 *
 * The empty value is still "lightest workload", which only ever picks an
 * officer — automatic allocation is not the place to hand work to a commercial
 * participant.
 */
function AllocateePicker({
  officers,
  value,
  onChange,
  excludeUserId,
}: {
  officers: Officer[];
  value: string;
  onChange: (id: string) => void;
  /** The case's raiser, kept out of the roster so it cannot be self-allocated (EZ1-I98). */
  excludeUserId?: string | null;
}) {
  // Verification is official work: only a Verification Officer may be allocated
  // a request, never a commercial agent (EZ1-I22). Agents are filtered out of
  // the roster here rather than shown and refused later.
  const eligible = officers.filter(
    (o) => (o.kind ?? 'officer') === 'officer' && o.id !== excludeUserId,
  );
  const away = eligible.filter((o) => o.onLeave).length;

  return (
    <label className="text-sm">
      <span className="text-gray-700">Allocate to</span>
      <select className="input mt-1" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Lightest workload (recommended)</option>
        {eligible.map((o) => (
          <option key={o.id} value={o.id} disabled={o.onLeave}>
            {o.name}
            {typeof o.openCount === 'number' ? `: ${o.openCount} open` : ''}
            {o.onLeave
              ? o.availabilityStatus === 'on_leave'
                ? ` — on leave${o.leaveTo ? ` until ${o.leaveTo}` : ''}`
                : ' — unavailable'
              : ''}
          </option>
        ))}
      </select>
      {away > 0 && (
        <span className="mt-1 block text-xs text-gray-500">
          {away === 1 ? '1 officer is' : `${away} officers are`} away and cannot take new work.
        </span>
      )}
    </label>
  );
}

const STATUS_TONE: Record<string, string> = {
  new: 'bg-amber-50 text-amber-800',
  open: 'bg-amber-50 text-amber-800',
  assigned: 'bg-blue-50 text-blue-800',
  allocated: 'bg-blue-50 text-blue-800',
  in_progress: 'bg-blue-50 text-blue-800',
  approved: 'bg-emerald-50 text-emerald-800',
  resolved: 'bg-emerald-50 text-emerald-800',
  closed: 'bg-gray-100 text-gray-600',
  rejected: 'bg-red-50 text-red-700',
  issue: 'bg-red-50 text-red-700',
  escalated: 'bg-red-50 text-red-700',
  additional_review: 'bg-amber-50 text-amber-800',
};

/**
 * The in-person portal, section by section.
 *
 * Each one is a question somebody actually has: what is waiting on me, what am
 * I part-way through, what have I handed on, what came back. Ordered the way
 * work moves rather than by status name.
 */
const SECTIONS: { key: string; label: string; blurb: string; statuses: string[] }[] = [
  {
    key: 'new',
    label: 'New',
    blurb: 'Raised and waiting for an administrator to allocate',
    statuses: ['new'],
  },
  {
    key: 'assigned',
    label: 'Assigned',
    blurb: 'Allocated to an officer, not yet started',
    statuses: ['assigned'],
  },
  {
    key: 'in_progress',
    label: 'In progress',
    blurb: 'An officer is out on it',
    statuses: ['in_progress'],
  },
  {
    key: 'submitted',
    label: 'Submitted',
    blurb: 'Findings are in and somebody has to read them',
    statuses: ['submitted', 'admin_review'],
  },
  {
    key: 'revisit',
    label: 'Needs another look',
    blurb: 'Sent back for a second visit',
    statuses: ['additional_review'],
  },
  {
    key: 'issues',
    label: 'Issues',
    blurb: 'Parked on something that has to be resolved elsewhere',
    statuses: ['issue'],
  },
  {
    key: 'approved',
    label: 'Approved',
    blurb: 'Done. The applicant is operating',
    statuses: ['approved'],
  },
  {
    key: 'rejected',
    label: 'Rejected',
    blurb: 'Refused, with the reason on the record',
    statuses: ['rejected'],
  },
];

/** Case status cards for the Cases tab, in the order work moves (EZ1-I83). */
export const CASE_FILTERS: { key: CaseStatus; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'allocated', label: 'Allocated' },
  { key: 'in_progress', label: 'In progress' },
  // A submitted resolution waiting on an administrator gets its own card so it
  // is not invisible between "in progress" and "resolved" (EZ1-I49).
  { key: 'resolution_submitted', label: 'In review' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'closed', label: 'Closed' },
];

function Pill({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        STATUS_TONE[status] ?? 'bg-gray-100 text-gray-600'
      }`}
    >
      {VERIFICATION_LABEL[status as VerificationStatus] ?? status.replace(/_/g, ' ')}
    </span>
  );
}

/**
 * The In-Person Verification portal.
 *
 * One page, two audiences. An officer sees the work allocated to them and
 * records what they found. An administrator sees everything, allocates it, and
 * manages the officer accounts. The split is enforced on the server — this
 * simply stops showing controls that would only ever come back 403.
 */
export default function Verification() {
  const qc = useQueryClient();
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  /*
    Cases have their own page now (EZ1-I219).

    They moved off the admin's copy of this screen first (EZ1-I203, to Support)
    and now off the officer's too, so no role works a case from here.

    An officer works them at /cases and an administrator at Support; either way
    this screen is the visit queue and nothing else, so the tab and its filter
    row are gone. `CaseRow` and `CASE_FILTERS` are still exported from here
    because both of those pages render them.
  */
  const showCases = false;
  const canAllocate = can(permissions, Permission.VERIFICATION_ALLOCATE);
  const canDecide = can(permissions, Permission.VERIFICATION_DECIDE);
  /*
   * Going out, and deciding on what came back, are two different people.
   *
   * Both used to hang off canDecide, which is how the officer ended up with
   * Approve, Reject and Needs another look under their own findings — the
   * field visit and the review of the field visit performed by the same hand.
   * The permissions are now separate on the server, so these are too, and an
   * administrator no longer gets a write-up form for a visit they did not make.
   */
  const canFieldwork = can(permissions, Permission.VERIFICATION_FIELDWORK);
  const canManageOfficers = can(permissions, Permission.ADMIN_OFFICER_MANAGE);

  /*
    Officers are managed on their own page (EZ1-I223).

    This screen is the queue of verification work. Who the officers are,
    creating one, and setting the areas they cover belong with the people
    rather than with the visits, so all of it moved to
    Admin -> Verification Officers.
  */
  const [tab, setTab] = useState<'requests' | 'cases'>('requests');
  // Null shows every section at once, which is what somebody with four visits
  // wants; picking one is for somebody with forty.
  const [section_, setSection] = useState<string | null>(null);
  const visibleSections = section_ ? SECTIONS.filter((x) => x.key === section_) : SECTIONS;
  // Which case status the Cases tab is filtered to, null for all (EZ1-I83).
  const [caseFilter, setCaseFilter] = useState<CaseStatus | null>(null);
  // Free-text search across the visits queue (EZ1-I90): business/applicant,
  // email, city, type or id.
  const [visitSearch, setVisitSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Polled, so a case or request an administrator allocates in another session
  // shows up here without the officer having to act first (EZ1-I81).
  const { data: metrics } = useQuery({
    queryKey: ['verification-metrics'],
    queryFn: async () => (await api.get('/verification/metrics')).data,
    retry: false,
    refetchInterval: 20_000,
  });

  const { data: requests } = useQuery({
    queryKey: ['verification-requests'],
    queryFn: async () => (await api.get('/verification/requests')).data,
    retry: false,
    refetchInterval: 20_000,
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

  // How much each officer is already carrying. Allocation without it is a name
  // picked off a list, which is how one officer ends up with everything.
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

  async function run(fn: () => Promise<unknown>, done?: string) {
    setError('');
    setNotice('');
    try {
      await fn();
      if (done) setNotice(done);
      qc.invalidateQueries({ queryKey: ['verification-requests'] });
      qc.invalidateQueries({ queryKey: ['verification-cases'] });
      qc.invalidateQueries({ queryKey: ['verification-metrics'] });
      qc.invalidateQueries({ queryKey: ['verification-officers'] });
    } catch (err) {
      setError(apiMessage(err, 'That action was rejected.'));
    }
  }

  const rows: VerificationRequest[] = requests?.data ?? [];
  const caseRows: SupportCase[] = cases?.data ?? [];
  // Lightest first, so the recommended choice is also the first one listed.
  const activeOfficers = officersWithLoad
    .filter((o) => o.isActive)
    .sort((a, b) => (a.openCount ?? 0) - (b.openCount ?? 0));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Verification</h1>
        <p className="page-subtitle">
          Agents and vendors are visited before they are activated. Nothing on this platform is
          approved from a form alone.
        </p>
      </div>

      {error && <p className="alert-critical">{error}</p>}
      {notice && <p className="alert-positive">{notice}</p>}

      {/*
        An officer sets whether they are taking fieldwork. Auto-allocation skips
        them while on leave or unavailable; an admin can still name them (I210).
        Admins do not hold fieldwork, so this is officers only.
      */}
      {canFieldwork && <MyAvailability />}

      {metrics && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/*
            Every tile is a filter now (EZ1-I83): clicking one opens the queue it
            counts. "Open cases" counts everything still in flight rather than the
            single literal `open` status, so a case does not vanish from the
            number the moment an administrator allocates it (EZ1-I81).
          */}
          <Metric
            label="Waiting"
            value={metrics.requests?.new ?? 0}
            onClick={() => {
              setTab('requests');
              setSection('new');
            }}
          />
          <Metric
            label="In progress"
            value={metrics.requests?.in_progress ?? 0}
            onClick={() => {
              setTab('requests');
              setSection('in_progress');
            }}
          />
          <Metric
            label="Approved"
            value={metrics.requests?.approved ?? 0}
            onClick={() => {
              setTab('requests');
              setSection('approved');
            }}
          />
          <Metric
            label="Rejected"
            value={metrics.requests?.rejected ?? 0}
            onClick={() => {
              setTab('requests');
              setSection('rejected');
            }}
          />
          {showCases && (
            <>
              <Metric
                label="Open cases"
                value={
                  (metrics.cases?.open ?? 0) +
                  (metrics.cases?.allocated ?? 0) +
                  (metrics.cases?.in_progress ?? 0) +
                  (metrics.cases?.escalated ?? 0)
                }
                onClick={() => {
                  setTab('cases');
                  setCaseFilter(null);
                }}
              />
              <Metric
                label="Resolved cases"
                value={metrics.cases?.resolved ?? 0}
                onClick={() => {
                  setTab('cases');
                  setCaseFilter('resolved');
                }}
              />
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === 'requests'} onClick={() => setTab('requests')}>
          Visits ({rows.length})
        </TabButton>
        {showCases && (
          <TabButton active={tab === 'cases'} onClick={() => setTab('cases')}>
            Cases ({caseRows.length})
          </TabButton>
        )}
      </div>

      {tab === 'requests' && (
        <div className="space-y-3">
          {/*
            One long queue is unusable to somebody carrying twenty visits. Each
            section is a question the officer or administrator has, in the order
            work moves — and a section with nothing in it is not shown, so the
            list does not fill up with empty headings.
          */}
          {/* Search the queue (EZ1-I90). */}
          <input
            className="input"
            placeholder="Search visits — business, applicant, city, type or id"
            value={visitSearch}
            onChange={(e) => setVisitSearch(e.target.value)}
          />

          <div className="flex flex-wrap gap-2">
            {SECTIONS.map((section) => {
              const count = rows.filter((r) => section.statuses.includes(r.status)).length;
              return (
                <button
                  key={section.key}
                  onClick={() => setSection(section.key === section_ ? null : section.key)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    section.key === section_
                      ? 'border-brand bg-brand text-brand-fg'
                      : count > 0
                        ? 'border-gray-300 text-gray-700 hover:border-brand'
                        : 'border-gray-200 text-gray-400'
                  }`}
                >
                  {section.label} ({count})
                </button>
              );
            })}
          </div>

          {visibleSections.map((section) => {
            const q = visitSearch.trim().toLowerCase();
            const sectionRows = rows
              .filter((r) => section.statuses.includes(r.status))
              .filter(
                (r) =>
                  !q ||
                  [r.subjectName, r.applicantEmail, r.applicantCity, r.applicantType, r.id]
                    .filter(Boolean)
                    .some((v) => String(v).toLowerCase().includes(q)),
              );
            if (sectionRows.length === 0) return null;
            return (
              <div key={section.key} className="space-y-3">
                <div>
                  <h2 className="section-title">
                    {section.label}{' '}
                    <span className="text-sm font-normal text-gray-400">
                      ({sectionRows.length})
                    </span>
                  </h2>
                  <p className="text-sm text-gray-600">{section.blurb}</p>
                </div>
                {sectionRows.map((r) => (
                  <RequestRow
                    key={r.id}
                    request={r}
                    officers={activeOfficers}
                    canAllocate={canAllocate}
                    canDecide={canDecide}
                    canFieldwork={canFieldwork}
                    onRun={run}
                  />
                ))}
              </div>
            );
          })}

          {rows.length === 0 && <p className="card text-sm text-gray-500">Nothing in the queue.</p>}
          {rows.length > 0 && visibleSections.every(
            (section) => rows.filter((r) => section.statuses.includes(r.status)).length === 0,
          ) && <p className="card text-sm text-gray-500">Nothing in that group.</p>}
        </div>
      )}

      {showCases && tab === 'cases' && (
        <div className="space-y-3">
          {/*
            Case status cards (EZ1-I83). Every status is its own filter with a
            live count, so an officer can jump straight to the resolved ones or
            the ones still in flight rather than reading a single long list.
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

          {(() => {
            const shown = caseFilter
              ? caseRows.filter((c) => c.status === caseFilter)
              : caseRows;
            if (caseRows.length === 0) {
              return <p className="card text-sm text-gray-500">No cases.</p>;
            }
            if (shown.length === 0) {
              return <p className="card text-sm text-gray-500">Nothing in that group.</p>;
            }
            return shown.map((c) => (
              <CaseRow
                key={c.id}
                item={c}
                officers={activeOfficers}
                canAllocate={canAllocate}
                onRun={run}
              />
            ));
          })()}
        </div>
      )}

    </div>
  );
}

function Metric({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
    </>
  );
  if (!onClick) return <div className="card">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="card text-left transition hover:border-brand hover:shadow-sm"
    >
      {body}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-sm px-3 py-1.5 text-sm ${
        active ? 'bg-brand-light text-brand-dark' : 'text-gray-600 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

function RequestRow({
  request,
  officers,
  canAllocate,
  canDecide,
  canFieldwork,
  onRun,
}: {
  request: VerificationRequest;
  officers: Officer[];
  canAllocate: boolean;
  canDecide: boolean;
  canFieldwork: boolean;
  onRun: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const [officerUserId, setOfficerUserId] = useState('');
  const [remarks, setRemarks] = useState('');
  const decided = request.status === 'approved' || request.status === 'rejected';
  // Findings are in; somebody has to read them and decide.
  const awaitingDecision = request.status === 'submitted' || request.status === 'admin_review';

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {/*
            The name, in the title. Every card in this queue used to read
            "planner verification", so telling two apart meant opening both —
            and an administrator working through a morning's approvals is
            mostly asking "which one is this".
          */}
          <p className="font-medium capitalize">
            {request.applicantType} verification
            {request.subjectName ? (
              <span className="text-gray-500"> — {request.subjectName}</span>
            ) : null}
          </p>
          <p className="text-xs text-gray-500">
            Raised {new Date(request.createdAt).toLocaleDateString()}
            {request.applicantCity ? ` · ${request.applicantCity}` : ''}
          </p>
          {(request.applicantEmail || request.applicantPhone) && (
            <p className="text-xs text-gray-500">
              {[request.applicantEmail, request.applicantPhone].filter(Boolean).join(' · ')}
            </p>
          )}
          {/*
            An allocation made on workload alone because nobody covers that city
            is a staffing gap, and it is invisible once the allocation has
            happened unless it is said here.
          */}
          {request.allocationBasis === 'workload_only' && request.applicantCity && (
            <p className="mt-0.5 text-xs text-amber-700">
              Nobody covers {request.applicantCity}, allocated on workload alone
            </p>
          )}
        </div>
        <Pill status={request.status} />
      </div>

      <Sla request={request} />

      {request.remarks && (
        <p className="rounded-sm bg-gray-50 p-2 text-sm text-gray-700">{request.remarks}</p>
      )}

      <SubjectDetails requestId={request.id} applicantType={request.applicantType} />

      {/*
        Only while the request is still unallocated. Once an officer is assigned
        (status leaves 'new'), the Allocate control disappears and the assigned
        officer is shown instead — the admin UI was still offering "Allocate to"
        after the backend had already assigned and the officer had submitted
        findings (EZ1-I26/I22).
      */}
      {canAllocate && request.status === 'new' && (
        <div className="flex flex-wrap items-end gap-2">
          <AllocateePicker
            officers={officers}
            value={officerUserId}
            onChange={setOfficerUserId}
          />
          <button
            className="btn"
            onClick={() =>
              onRun(
                () =>
                  api.put(
                    `/verification/requests/${request.id}/allocate`,
                    officerUserId ? { officerUserId } : {},
                  ),
                'Allocated. The officer will see it in their queue.',
              )
            }
          >
            Allocate
          </button>
          <p className="w-full text-xs text-gray-500">
            Left to itself this goes to whoever is carrying least. Name an officer only when
            something about this case says it should be theirs.
          </p>
        </div>
      )}

      {/* After allocation, who it went to — replacing the Allocate control. */}
      {request.status !== 'new' && request.assignedToUserId && (
        <p className="rounded-sm border border-gray-200 bg-gray-50 p-2 text-sm text-gray-700">
          Assigned officer:{' '}
          <span className="font-medium text-gray-900">
            {officers.find((o) => o.id === request.assignedToUserId)?.name ?? 'Verification officer'}
          </span>
        </p>
      )}

      {/* What the officer wrote up, once they have. */}
      {request.findings && (
        <div className="rounded-sm border border-gray-200 bg-gray-50 p-3 text-sm">
          <p className="font-medium text-gray-900">
            {request.findings.visited ? 'Visited' : 'Could not attend'}
            <span className="ml-2 font-normal text-gray-500">
              recommends {RECOMMENDATION_LABEL[request.findings.recommendation]}
            </span>
            {request.revisitCount > 0 && (
              <span className="ml-2 text-xs text-amber-700">
                visit {request.revisitCount + 1}
              </span>
            )}
          </p>
          {/* Who filed it and when, so the reviewer is not guessing (EZ1-I26). */}
          <p className="mt-0.5 text-xs text-gray-500">
            Findings submitted
            {request.assignedToUserId
              ? ` by ${
                  officers.find((o) => o.id === request.assignedToUserId)?.name ??
                  'the verification officer'
                }`
              : ''}
            {request.submittedAt ? ` on ${new Date(request.submittedAt).toLocaleString()}` : ''}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-gray-700">
            {request.findings.observations}
          </p>
          {request.findings.issues.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-red-700">
              {request.findings.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
          {request.findings.evidence.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-2">
              {request.findings.evidence.map((url, i) => (
                <a
                  key={url}
                  className="text-xs text-brand underline"
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Evidence {i + 1}
                </a>
              ))}
            </p>
          )}
        </div>
      )}

      {/*
        The officer's half: attend, then write up what they saw. Deciding on
        the strength of it is a separate step, below — an approval that rests
        on nothing is what makes a verification a checkbox.
      */}
      {canFieldwork && !decided && !awaitingDecision && (
        <div className="space-y-2 border-t pt-3">
          {(request.status === 'assigned' || request.status === 'additional_review') && (
            <button
              className="btn-outline"
              onClick={() => onRun(() => api.put(`/verification/requests/${request.id}/start`))}
            >
              {request.status === 'additional_review' ? 'Go back out' : 'Start the visit'}
            </button>
          )}
          <FindingsForm
            requestId={request.id}
            onRun={onRun}
            revisit={request.revisitCount > 0}
          />
        </div>
      )}

      {/* The reviewer's half. */}
      {canDecide && awaitingDecision && (
        <div className="space-y-2 border-t pt-3">
          {request.status === 'submitted' && (
            <button
              className="btn-outline"
              onClick={() =>
                onRun(
                  () => api.put(`/verification/requests/${request.id}/review`),
                  'Yours to decide. Nobody else will pick it up.',
                )
              }
            >
              Take this for review
            </button>
          )}
          <textarea
            className="input"
            rows={2}
            placeholder="Your reasoning. Required for anything other than an approval."
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              className="btn"
              onClick={() =>
                onRun(
                  () =>
                    api.put(`/verification/requests/${request.id}/decide`, {
                      status: 'approved',
                      remarks: remarks || undefined,
                    }),
                  'Approved. The applicant is now active.',
                )
              }
            >
              Approve
            </button>
            <button
              className="btn-outline"
              onClick={() =>
                onRun(
                  () =>
                    api.put(`/verification/requests/${request.id}/decide`, {
                      status: 'additional_review',
                      remarks,
                    }),
                  'Sent back. It is on the officer\u2019s queue again.',
                )
              }
            >
              Needs another look
            </button>
            <button
              className="btn-outline text-red-600"
              onClick={() =>
                onRun(() =>
                  api.put(`/verification/requests/${request.id}/decide`, {
                    status: 'rejected',
                    remarks,
                  }),
                )
              }
            >
              Reject
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Sending it back clears the findings and returns it to the officer, who visits again.
          </p>
        </div>
      )}

      {/*
        The targeted alternative to "Needs another look" (EZ1-I205): reopen only
        the fields that are wrong, so the vendor fixes those and nothing else.
        Vendor businesses only, and only while the request is still live.
      */}
      {canDecide &&
        request.applicantType === 'vendor' &&
        request.subjectId &&
        !decided &&
        request.status !== 'new' && (
          <RequestCorrection requestId={request.id} onRun={onRun} />
        )}
    </div>
  );
}

const RECOMMENDATION_LABEL: Record<string, string> = {
  approve: 'approval',
  reject: 'rejection',
  revisit: 'another visit',
};

/**
 * Ask the vendor to correct specific business fields and resubmit (EZ1-I205).
 *
 * A tighter send-back than "Needs another look": the administrator picks exactly
 * which fields are wrong, and the listing reopens for only those. The server
 * keeps the flagged fields and a snapshot of their values, so the resubmission
 * shows up as previous-vs-updated on the next review.
 */
function RequestCorrection({
  requestId,
  onRun,
}: {
  requestId: string;
  onRun: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<string[]>([]);
  const [reason, setReason] = useState('');

  const toggle = (key: string) =>
    setFields((prev) => (prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]));

  if (!open) {
    return (
      <div className="border-t pt-3">
        <button className="btn-outline" onClick={() => setOpen(true)}>
          Request correction
        </button>
      </div>
    );
  }

  const ready = fields.length > 0 && reason.trim().length >= 5;

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-sm font-medium text-gray-900">Which fields need correcting?</p>
      <div className="grid gap-1 sm:grid-cols-2">
        {CORRECTABLE_FIELD_KEYS.map((key) => (
          <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={fields.includes(key)}
              onChange={() => toggle(key)}
            />
            {CORRECTION_FIELD_LABELS[key]}
          </label>
        ))}
      </div>
      <textarea
        className="input"
        rows={2}
        placeholder="What is wrong and what the vendor should change. They see this verbatim."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <button
          className="btn"
          disabled={!ready}
          onClick={() =>
            onRun(async () => {
              await api.put(`/verification/requests/${requestId}/request-correction`, {
                fields,
                reason: reason.trim(),
              });
              setOpen(false);
              setFields([]);
              setReason('');
            }, 'Correction requested. The vendor can edit only those fields and resubmit.')
          }
        >
          Send correction request
        </button>
        <button className="btn-outline" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <p className="text-xs text-gray-500">
        The listing reopens for only these fields; everything else stays locked until it is
        resubmitted and re-verified.
      </p>
    </div>
  );
}

/**
 * What the officer writes up after attending.
 *
 * `visited` is asked separately from the observations because "I went and it
 * checked out" and "I could not find the address" are both findings, and the
 * second is the one that matters most.
 */
function FindingsForm({
  requestId,
  onRun,
  revisit,
}: {
  requestId: string;
  onRun: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
  revisit: boolean;
}) {
  const [visited, setVisited] = useState(true);
  const [observations, setObservations] = useState('');
  const [issues, setIssues] = useState('');
  const [recommendation, setRecommendation] = useState<'approve' | 'reject' | 'revisit'>('approve');
  const [problem, setProblem] = useState('');

  const issueList = issues
    .split('\n')
    .map((i) => i.trim())
    .filter(Boolean);

  function submit() {
    if (observations.trim().length < 10) {
      setProblem('Write up what you actually saw.');
      return;
    }
    if (recommendation !== 'approve' && issueList.length === 0) {
      setProblem('List what did not check out, one per line.');
      return;
    }
    setProblem('');
    void onRun(
      () =>
        api.put(`/verification/requests/${requestId}/findings`, {
          visited,
          observations: observations.trim(),
          issues: issueList,
          recommendation,
        }),
      'Submitted. An administrator decides from here.',
    );
  }

  return (
    <div className="space-y-2 rounded-sm bg-gray-50 p-3">
      <p className="text-sm font-medium text-gray-800">
        {revisit ? 'Write up the return visit' : 'Write up the visit'}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={visited}
          onChange={(e) => setVisited(e.target.checked)}
        />
        <span className="text-gray-700">I attended the address</span>
      </label>
      <textarea
        className="input"
        rows={3}
        placeholder="Attended the address. Kitchen and two vans present; GST certificate on the wall."
        value={observations}
        onChange={(e) => setObservations(e.target.value)}
      />
      <label className="block text-sm">
        <span className="text-gray-700">Anything that did not check out</span>
        <textarea
          className="input mt-1"
          rows={2}
          placeholder="One per line"
          value={issues}
          onChange={(e) => setIssues(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        <span className="text-gray-700">What you recommend</span>
        <select
          className="input mt-1"
          value={recommendation}
          onChange={(e) => setRecommendation(e.target.value as 'approve' | 'reject' | 'revisit')}
        >
          <option value="approve">Approve</option>
          <option value="reject">Reject</option>
          <option value="revisit">Somebody should go again</option>
        </select>
        <span className="mt-1 block text-xs text-gray-500">
          A recommendation, not a decision. An administrator reads this and decides.
        </span>
      </label>
      {problem && <p className="text-sm text-red-600">{problem}</p>}
      <button className="btn" onClick={submit}>
        Submit findings
      </button>
    </div>
  );
}

/**
 * What an officer can do to resolve a case, by what the case is about (EZ1-I181).
 *
 * A generic "Resolve" told an officer nothing about a payout dispute versus a
 * locked listing. Each subject gets the actions that make sense for it. A
 * `settle` action proposes an outcome the administrator approves before anything
 * moves — `release`/`refund` are the ones that actually move escrow, `no_action`
 * records what was done and closes it. `escalate` sends it for a physical visit.
 * The `key` is stored so the resolution reads as the thing it was, and so
 * `unlock_listing` can reopen the vendor's listing when it is approved.
 */
type CaseAction =
  | {
      key: string;
      label: string;
      kind: 'settle';
      outcome: 'release' | 'refund' | 'no_action';
      primary?: boolean;
    }
  | { key: string; label: string; kind: 'escalate' }
  /*
   * `confirm_identity` is the one action that writes outside the case, and it
   * is the officer's alone: IDENTITY_CONFIRM is granted to IN_PERSON and
   * withheld even from an administrator, because seeing the document and the
   * person together is what the visit is for.
   *
   * The permission, the route, the audit action and the `idVerifiedByUserId`
   * column all shipped with no control anywhere that called them, so the only
   * way a profile could ever read "Verified" was the self-service Aadhaar OTP
   * (council round 2). A case about a profile is where an officer actually has
   * that profile in front of them.
   */
  | { key: string; label: string; kind: 'confirm_identity'; primary?: boolean };

const CASE_ACTIONS: Record<string, CaseAction[]> = {
  booking: [
    { key: 'verify_booking', label: 'Verify booking', kind: 'settle', outcome: 'release', primary: true },
    { key: 'update_booking_status', label: 'Update booking status', kind: 'settle', outcome: 'no_action' },
    { key: 'confirm_cancellation', label: 'Confirm cancellation', kind: 'settle', outcome: 'refund' },
    { key: 'escalate', label: 'Escalate', kind: 'escalate' },
  ],
  payment: [
    { key: 'verify_payment', label: 'Verify payment', kind: 'settle', outcome: 'no_action', primary: true },
    { key: 'verify_escrow', label: 'Verify escrow', kind: 'settle', outcome: 'no_action' },
    { key: 'recommend_release', label: 'Recommend escrow release', kind: 'settle', outcome: 'release' },
    { key: 'recommend_refund', label: 'Recommend refund', kind: 'settle', outcome: 'refund' },
    { key: 'escalate', label: 'Escalate', kind: 'escalate' },
  ],
  vendor: [
    { key: 'unlock_listing', label: 'Unlock business details', kind: 'settle', outcome: 'no_action', primary: true },
    { key: 'request_correction', label: 'Request correction', kind: 'settle', outcome: 'no_action' },
    { key: 'review_changes', label: 'Approve or reject changes', kind: 'settle', outcome: 'no_action' },
    { key: 'escalate', label: 'Escalate', kind: 'escalate' },
  ],
  availability: [
    { key: 'review', label: 'Review', kind: 'settle', outcome: 'no_action', primary: true },
    { key: 'correct', label: 'Correct', kind: 'settle', outcome: 'no_action' },
    { key: 'escalate', label: 'Escalate', kind: 'escalate' },
  ],
  account: [
    { key: 'review', label: 'Review', kind: 'settle', outcome: 'no_action', primary: true },
    { key: 'escalate', label: 'Escalate', kind: 'escalate' },
  ],
  profile: [
    { key: 'confirm_identity', label: 'Confirm identity document', kind: 'confirm_identity', primary: true },
    { key: 'review', label: 'Review', kind: 'settle', outcome: 'no_action' },
    { key: 'escalate', label: 'Escalate', kind: 'escalate' },
  ],
  other: [
    { key: 'resolve', label: 'Resolve', kind: 'settle', outcome: 'no_action', primary: true },
    { key: 'escalate', label: 'Escalate', kind: 'escalate' },
  ],
};

export function CaseRow({
  item,
  officers,
  canAllocate,
  onRun,
}: {
  item: SupportCase;
  officers: Officer[];
  canAllocate: boolean;
  onRun: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const [officerUserId, setOfficerUserId] = useState('');
  const [findings, setFindings] = useState(item.findings ?? '');
  const [amount, setAmount] = useState('');
  // Notes the officer attaches to whichever resolution action they choose
  // (EZ1-I181). Recorded as the settlement note the vendor reads.
  const [resNotes, setResNotes] = useState('');
  const settled = item.status === 'resolved' || item.status === 'closed';
  // An officer has proposed a resolution and it is waiting on an administrator
  // to approve it or send it back (EZ1-I49) — a different screen from settling a
  // fresh case, so the two do not blur into one another.
  const inReview = item.status === 'resolution_submitted' || item.status === 'admin_review';

  /*
   * Whether the case is currently somebody else's move.
   *
   * Allocate / Needs a visit / Waiting on them stayed on screen after the case
   * had been handed to an officer, which read as though the administrator still
   * had something to do — and re-allocating a case an officer had already
   * started was one stray click away (EZ1-I218). While it sits with the officer
   * or with whoever was asked for information, the strip goes; it comes back
   * the moment the ball is back in the administrator's court, which is
   * `reassigned` (sent back), `escalated` (needs a visit arranged) and the
   * untouched states.
   */
  const withSomebodyElse =
    item.status === 'allocated' ||
    item.status === 'in_progress' ||
    item.status === 'waiting_for_information';

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{item.title}</p>
          {/* Case id, type and raised time up front, so the record identifies
              itself for the admin and officer reviewing it (EZ1-I88, EZ1-I112). */}
          <p className="text-xs capitalize text-gray-500">
            Case {item.id.slice(0, 8)} · {item.subjectType.replace(/_/g, ' ')} · raised{' '}
            {new Date(item.createdAt).toLocaleString()}
          </p>
          {item.assignedToUserId && (
            <p className="text-xs text-gray-500">
              Assigned to{' '}
              <span className="text-gray-700">
                {officers.find((o) => o.id === item.assignedToUserId)?.name ?? 'an officer'}
              </span>
            </p>
          )}
        </div>
        <Pill status={item.status} />
      </div>

      <p className="text-sm text-gray-700">{item.description}</p>

      {/* Who raised it and, for a booking/payment case, the booking and parties
          — so an admin can investigate without opening other screens (EZ1-I74). */}
      {(item.raisedByName || item.raisedByEmail) && (
        <p className="text-sm text-gray-600">
          Raised by{' '}
          <span className="font-medium text-gray-800">
            {item.raisedByName ?? item.raisedByEmail}
          </span>
          {item.raisedByRole ? ` · ${item.raisedByRole}` : ''}
          {item.raisedByName && item.raisedByEmail ? ` · ${item.raisedByEmail}` : ''}
        </p>
      )}

      {item.booking && (
        <div className="rounded-sm bg-gray-50 p-2 text-sm text-gray-700">
          <p className="font-medium text-gray-900">
            Booking {item.booking.id.slice(0, 8)} · {item.booking.status.replace(/_/g, ' ')}
          </p>
          <p className="text-gray-600">
            {item.booking.currency} {Number(item.booking.amount).toLocaleString('en-IN')}
            {item.booking.buyerName ? ` · Buyer: ${item.booking.buyerName}` : ''}
            {item.booking.providerName ? ` · Provider: ${item.booking.providerName}` : ''}
          </p>
        </div>
      )}

      {/* The escrow behind a booking or payout case, so the officer sees the
          money it is actually about and not just the booking total (EZ1-I149). */}
      {item.payments && item.payments.length > 0 && (
        <div className="rounded-sm bg-gray-50 p-2 text-sm text-gray-700">
          <p className="font-medium text-gray-900">Escrow</p>
          <ul className="mt-1 space-y-0.5">
            {item.payments.map((p, i) => (
              <li key={i} className="text-gray-600">
                <span className="capitalize">{p.milestone.replace(/_/g, ' ')}</span> ·{' '}
                <span className="capitalize">{p.status.replace(/_/g, ' ')}</span> ·{' '}
                {Number(p.amount).toLocaleString('en-IN')}
                {Number(p.payoutAmount) > 0
                  ? ` · payout ${Number(p.payoutAmount).toLocaleString('en-IN')}`
                  : ''}
                {p.payoutNote ? ` · ${p.payoutNote}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The business's own row for a listing complaint — its standing and the
          compliance details an officer would otherwise open Verification for
          (EZ1-I149). */}
      {item.business && (
        <div className="rounded-sm bg-gray-50 p-2 text-sm text-gray-700">
          <p className="font-medium text-gray-900">
            {item.business.name} · <span className="capitalize">{item.business.category.replace(/_/g, ' ')}</span>
          </p>
          <p className="text-gray-600">
            <span className="capitalize">{item.business.status.replace(/_/g, ' ')}</span>
            {item.business.isApproved ? ' · approved' : ' · not approved'}
            {item.business.city ? ` · ${item.business.city}` : ''}
            {item.business.revisionCount > 0 ? ` · ${item.business.revisionCount} revisions` : ''}
          </p>
          <p className="text-gray-600">
            {item.business.gstNumber ? `GST ${item.business.gstNumber}` : 'No GST'}
            {item.business.panNumber ? ` · PAN ${item.business.panNumber}` : ''}
            {item.business.tradingSince ? ` · trading since ${item.business.tradingSince}` : ''}
          </p>
          {item.business.decisionReason && (
            <p className="text-gray-600">Last decision: {item.business.decisionReason}</p>
          )}
        </div>
      )}

      {/* The vendor's upcoming windows and any overbooked ones, for an
          availability complaint (EZ1-I149). */}
      {item.availability && (
        <div className="rounded-sm bg-gray-50 p-2 text-sm text-gray-700">
          <p className="font-medium text-gray-900">
            Availability · {item.availability.upcoming} upcoming
            {item.availability.conflicts > 0 ? ` · ${item.availability.conflicts} overbooked` : ''}
          </p>
          {item.availability.slots.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {item.availability.slots.map((s, i) => (
                <li key={i} className="text-gray-600">
                  {s.date} {s.startTime}–{s.endTime} · {s.confirmed}/{s.capacity} booked
                  {s.pending > 0 ? ` · ${s.pending} pending` : ''} ·{' '}
                  <span className="capitalize">{s.status.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* The account's standing for an account complaint (EZ1-I149). */}
      {item.account && (
        <p className="rounded-sm bg-gray-50 p-2 text-sm text-gray-700">
          Account {item.account.email ?? ''}
          {item.account.role ? ` · ${item.account.role}` : ''} ·{' '}
          {item.account.isActive ? 'active' : 'suspended'}
        </p>
      )}

      {item.milestone && (
        <p className="text-sm text-gray-600">
          The argument is over the{' '}
          <span className="font-medium">
            {(MILESTONE_LABEL[item.milestone] ?? item.milestone).toLowerCase()}
          </span>
          .
        </p>
      )}

      {item.requiresPhysicalVerification && (
        <p className="rounded-sm bg-amber-50 p-2 text-sm text-amber-900">
          Escalated. This one needs somebody on the ground.
        </p>
      )}

      {(item.evidence?.length ?? 0) > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-900">Evidence</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {item.evidence.map((url) => (
              <li key={url}>
                <a
                  className="text-brand underline"
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {url.length > 60 ? `${url.slice(0, 60)}\u2026` : url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {item.settlementOutcome && !inReview && (
        <p className="text-sm text-gray-600">
          Settled: <span className="font-medium">{item.settlementOutcome.replace(/_/g, ' ')}</span>
          {item.resolutionAction
            ? ` · ${CASE_ACTION_LABEL[item.resolutionAction] ?? item.resolutionAction.replace(/_/g, ' ')}`
            : ''}
        </p>
      )}

      {/* The officer's proposal, and the administrator's decision on it (EZ1-I49). */}
      {inReview && (
        <div className="space-y-2 rounded-sm border border-sky-200 bg-sky-50 p-3">
          <p className="text-sm font-medium text-sky-900">Resolution submitted for review</p>
          {item.resolutionAction && (
            <p className="text-sm text-sky-900">
              Action:{' '}
              <span className="font-medium">
                {CASE_ACTION_LABEL[item.resolutionAction] ?? item.resolutionAction.replace(/_/g, ' ')}
              </span>
            </p>
          )}
          {item.settlementOutcome && (
            <p className="text-sm text-sky-900">
              Proposed: <span className="font-medium">{item.settlementOutcome.replace(/_/g, ' ')}</span>
            </p>
          )}
          {item.findings && <p className="whitespace-pre-wrap text-sm text-sky-900">{item.findings}</p>}
          {item.settlementNotes && (
            <p className="whitespace-pre-wrap text-sm text-sky-900">{item.settlementNotes}</p>
          )}
          {canAllocate ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                className="btn"
                onClick={() =>
                  onRun(
                    () => api.put(`/verification/cases/${item.id}/review`, { decision: 'approve' }),
                    'Approved. The resolution stands.',
                  )
                }
              >
                Approve resolution
              </button>
              <button
                className="btn-outline"
                onClick={() => {
                  const note = window.prompt('Why is it going back? The next officer needs to know.');
                  if (note && note.trim().length >= 3) {
                    void onRun(
                      () =>
                        api.put(`/verification/cases/${item.id}/review`, {
                          decision: 'reassign',
                          note: note.trim(),
                        }),
                      'Sent back for another look.',
                    );
                  }
                }}
              >
                Send back
              </button>
            </div>
          ) : (
            <p className="text-xs text-sky-800">This is with an administrator for a decision.</p>
          )}
        </div>
      )}

      {/*
        With the officer, so nothing here is the administrator's to press. The
        assignment and what it is waiting on stay visible above; only the
        actions go (EZ1-I218).
      */}
      {canAllocate && !settled && !inReview && withSomebodyElse && (
        <p className="text-xs text-gray-500">
          {item.status === 'waiting_for_information'
            ? 'Waiting on a reply. Actions return when they respond.'
            : 'With the assigned officer. Actions return when they report back.'}
        </p>
      )}

      {canAllocate && !settled && !inReview && !withSomebodyElse && (
        <div className="flex flex-wrap items-end gap-2">
          <AllocateePicker
            officers={officers}
            value={officerUserId}
            onChange={setOfficerUserId}
            excludeUserId={item.raisedByUserId}
          />
          <button
            className="btn"
            onClick={() =>
              onRun(() =>
                api.put(
                  `/verification/cases/${item.id}/allocate`,
                  officerUserId ? { officerUserId } : {},
                ),
              )
            }
          >
            Allocate
          </button>
          {!item.requiresPhysicalVerification && (
            <button
              className="btn-outline"
              onClick={() => {
                const reason = window.prompt(
                  'Why does this need somebody on the ground? The next officer reads this.',
                );
                if (reason && reason.trim().length >= 10) {
                  void onRun(
                    () =>
                      api.put(`/verification/cases/${item.id}/escalate`, {
                        reason: reason.trim(),
                      }),
                    'Escalated. It now needs a physical visit before it can be settled.',
                  );
                }
              }}
            >
              Needs a visit
            </button>
          )}
          <button
            className="btn-outline"
            onClick={() => {
              const note = window.prompt('What have you asked for, and from whom?');
              if (note && note.trim().length >= 10) {
                void onRun(
                  () =>
                    api.put(`/verification/cases/${item.id}/await-information`, {
                      reason: note.trim(),
                    }),
                  'Parked. The clock is on them now, not on you.',
                );
              }
            }}
          >
            Waiting on them
          </button>
        </div>
      )}

      {/*
        Sequential workflow (EZ1-I99): recording findings and proposing a
        resolution is the assigned officer's step, so the administrator — who
        allocates and later reviews — is not shown these controls. They appear
        once the case is in an officer's hands and disappear once it is settled
        or already submitted for review.
      */}
      {!canAllocate && !settled && !inReview && (
        <div className="space-y-2 border-t pt-3">
          <textarea
            className="input"
            rows={2}
            placeholder="What the investigation found."
            value={findings}
            onChange={(e) => setFindings(e.target.value)}
          />
          <button
            className="btn-outline"
            disabled={findings.trim().length < 10}
            onClick={() =>
              onRun(() => api.put(`/verification/cases/${item.id}/findings`, { findings }))
            }
          >
            Record findings
          </button>

          {/*
            Category-specific resolution actions (EZ1-I181). What an officer can
            do depends on what the case is about — a payout is verified or
            refunded, a locked listing is unlocked — instead of one generic
            Resolve. Each action records what was done plus these notes and
            proposes a resolution the administrator approves; release/refund and
            the listing unlock are the ones that actually move something.
          */}
          {(() => {
            const actions = (CASE_ACTIONS[item.subjectType] ?? CASE_ACTIONS.other).filter(
              // Confirming an identity needs the profile it is about; a case
              // raised without a subject id has nothing to confirm against.
              (a) => a.kind !== 'confirm_identity' || Boolean(item.subjectId),
            );
            const money = item.subjectType === 'booking' || item.subjectType === 'payment';
            const notes = resNotes.trim();

            const run = (a: CaseAction) => {
              if (a.kind === 'confirm_identity') {
                void onRun(
                  () => api.put(`/verification/identity/${item.subjectId}/verify`),
                  'Identity confirmed. It now shows as verified on their profile.',
                );
                return;
              }
              if (a.kind === 'escalate') {
                const reason = window.prompt(
                  'Why does this need somebody on the ground? The next officer reads this.',
                );
                if (reason && reason.trim().length >= 10) {
                  void onRun(
                    () =>
                      api.put(`/verification/cases/${item.id}/escalate`, {
                        reason: reason.trim(),
                      }),
                    'Escalated. It now needs a physical visit before it can be settled.',
                  );
                }
                return;
              }
              void onRun(
                () =>
                  api.put(`/verification/cases/${item.id}/settle`, {
                    outcome: a.outcome,
                    action: a.key,
                    notes: notes || undefined,
                  }),
                'Recommendation submitted for review.',
              );
            };

            return (
              <div className="rounded-sm bg-gray-50 p-3">
                <p className="text-sm font-medium text-gray-800">Resolution</p>
                <p className="mb-2 text-xs text-gray-600">
                  {money
                    ? 'Money on the disputed booking stays frozen. You recommend the action; an administrator approves it before anything moves.'
                    : 'You recommend the action; an administrator approves it before the case closes.'}
                </p>
                <textarea
                  className="input mb-2"
                  rows={2}
                  placeholder="Notes on the resolution (optional)"
                  value={resNotes}
                  onChange={(e) => setResNotes(e.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  {actions.map((a) => (
                    <button
                      key={a.key}
                      className={a.kind !== 'escalate' && a.primary ? 'btn' : 'btn-outline'}
                      onClick={() => run(a)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>

                {/* Partial settlement is kept for money cases: it needs an
                    amount, so it sits apart from the one-click actions. */}
                {money && (
                  <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-gray-200 pt-2">
                    <label className="text-sm">
                      <span className="text-gray-700">Partial amount</span>
                      <input
                        className="input mt-1 w-32"
                        type="number"
                        min={1}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </label>
                    <button
                      className="btn-outline"
                      disabled={!amount}
                      onClick={() =>
                        onRun(
                          () =>
                            api.put(`/verification/cases/${item.id}/settle`, {
                              outcome: 'partial',
                              amount: Number(amount),
                              action: 'partial_settlement',
                              notes: resNotes.trim() || undefined,
                            }),
                          'Recommendation submitted for review.',
                        )
                      }
                    >
                      Recommend partial settlement
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

type AvailabilityStatus = 'available' | 'on_leave' | 'unavailable';

interface Availability {
  status: AvailabilityStatus;
  leaveFrom: string | null;
  leaveTo: string | null;
  leaveReason: string | null;
  /** Whether allocation is skipping the officer right now. */
  onLeaveNow: boolean;
}

const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  available: 'Available',
  on_leave: 'On leave',
  unavailable: 'Unavailable',
};

/**
 * An officer setting whether they are taking fieldwork.
 *
 * Available is the working default. On leave carries a start and end date, so a
 * leave booked for next week does not pull the officer out of allocation today;
 * unavailable is an open-ended stand down. Auto-allocation skips anyone who is
 * not available now — an administrator can still name them directly, which is
 * why this only sets a preference rather than blocking work outright.
 */
function MyAvailability() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['my-availability'],
    queryFn: async () =>
      (await api.get('/verification/officers/me/availability')).data as Availability,
    retry: false,
  });

  const [status, setStatus] = useState<AvailabilityStatus>('available');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Seed the form from the server once, then leave the officer's edits alone.
  useEffect(() => {
    if (data && !seeded) {
      setStatus(data.status);
      setFrom(data.leaveFrom ?? '');
      setTo(data.leaveTo ?? '');
      setReason(data.leaveReason ?? '');
      setSeeded(true);
    }
  }, [data, seeded]);

  const onLeave = status === 'on_leave';
  const datesOk = !onLeave || (from !== '' && to !== '' && to >= from);

  async function save() {
    setError('');
    setNotice('');
    try {
      await api.put('/verification/officers/me/availability', {
        status,
        leaveFrom: onLeave ? from : undefined,
        leaveTo: onLeave ? to : undefined,
        leaveReason: onLeave && reason ? reason : undefined,
      });
      setNotice('Availability updated.');
      qc.invalidateQueries({ queryKey: ['my-availability'] });
      // So the admin roster and the allocation workload reflect it at once.
      qc.invalidateQueries({ queryKey: ['verification-officers'] });
      qc.invalidateQueries({ queryKey: ['verification-workload'] });
    } catch (err) {
      setError(apiMessage(err, 'Could not update availability.'));
    }
  }

  const badgeTone =
    data?.status === 'available'
      ? 'bg-positive-bg text-positive-fg'
      : 'bg-caution-bg text-caution-fg';

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section-title">My availability</h2>
        {data && (
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeTone}`}>
            {AVAILABILITY_LABEL[data.status]}
            {data.status === 'on_leave' && data.leaveFrom && data.leaveTo
              ? ` · ${data.leaveFrom} to ${data.leaveTo}`
              : ''}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-600">
        New verifications are not auto-allocated to you while you are on leave or unavailable. An
        administrator can still assign one to you by name.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-gray-600">Status</span>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as AvailabilityStatus)}
          >
            {(Object.keys(AVAILABILITY_LABEL) as AvailabilityStatus[]).map((s) => (
              <option key={s} value={s}>
                {AVAILABILITY_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {onLeave && (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">From</span>
            <input
              className="input"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">To</span>
            <input
              className="input"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">Reason (optional)</span>
            <input
              className="input"
              placeholder="e.g. Annual leave"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>
      )}

      {onLeave && !datesOk && from !== '' && to !== '' && (
        <p className="text-xs text-critical-fg">End date cannot be before the start date.</p>
      )}
      {error && <p className="alert-critical">{error}</p>}
      {notice && <p className="alert-positive">{notice}</p>}

      <button className="btn" disabled={!datesOk} onClick={save}>
        Save availability
      </button>
    </div>
  );
}

/**
 * The 72-hour clock.
 *
 * The server has computed and stored slaDeadline since the verification schema
 * was written, and returned it on every request; nothing ever displayed it. A
 * deadline nobody can see is not a deadline — it is a column — and the whole
 * point of the SLA is that the officer holding the request and the
 * administrator watching the queue both know how long is left before anybody
 * has to ask.
 *
 * Three states rather than a countdown to the second. A ticking timer implies
 * a precision this does not have and makes a queue of twenty cards restless;
 * what somebody needs is whether this one is fine, tight, or already late.
 */
function Sla({ request }: { request: VerificationRequest }) {
  const decided = request.status === 'approved' || request.status === 'rejected';
  if (!request.slaDeadline || decided) return null;

  const deadline = new Date(request.slaDeadline);
  const hours = Math.round((deadline.getTime() - Date.now()) / 3_600_000);
  const breached = Boolean(request.slaBreachedAt) || hours < 0;
  // Six hours is roughly the point at which a visit can no longer be arranged
  // for today, which is what makes it the moment to say something.
  const urgent = !breached && hours <= 6;

  const tone = breached
    ? 'bg-critical-bg text-critical-fg'
    : urgent
      ? 'bg-caution-bg text-caution-fg'
      : 'bg-gray-50 text-gray-600';

  const label = breached
    ? `Overdue by ${Math.abs(hours)}h`
    : urgent
      ? `Due in ${hours}h`
      : `${hours}h left`;

  return (
    <p className={`flex flex-wrap items-center gap-x-2 rounded-sm px-2 py-1 text-xs ${tone}`}>
      <span className="font-medium">{label}</span>
      <span className="opacity-80">
        72-hour deadline {deadline.toLocaleString()}
        {request.verificationStartedAt
          ? ` · visit started ${new Date(request.verificationStartedAt).toLocaleDateString()}`
          : ''}
      </span>
    </p>
  );
}

/**
 * What is actually being verified.
 *
 * The queue used to show a request id and an applicant type, which tells an
 * officer nothing about where to go or what to check. This is the record the
 * decision is about — the business or agency as the applicant filled it in —
 * plus every hand the request has passed through, so an approval can be read
 * back later and understood.
 */
/** A vendor service with its priced offerings, for the officer's review (EZ1-I25). */
interface ServiceSummary {
  id: string;
  active: boolean;
  definition?: { name?: string } | null;
  category?: { name?: string } | null;
  offerings?: {
    id: string;
    name: string;
    price: string | number | null;
    pricingModel?: string;
  }[];
}

function SubjectDetails({
  requestId,
  applicantType,
}: {
  requestId: string;
  applicantType?: string;
}) {
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ['verification-request', requestId],
    queryFn: async () => (await api.get(`/verification/requests/${requestId}`)).data,
    enabled: open,
    retry: false,
  });

  if (!open) {
    return (
      <button className="btn-outline" onClick={() => setOpen(true)}>
        Show the business details
      </button>
    );
  }

  const subject = data?.subject as Record<string, unknown> | null;
  const applicant = data?.applicant as Record<string, unknown> | null;
  // The stored history entries are { at, byUserId, status, remarks } (see the
  // VerificationRequest entity). Reading them as { action, note } left
  // entry.action undefined, and entry.action.replace(...) below then threw —
  // which the page's error boundary caught as "This page could not be shown"
  // the moment an officer or admin opened any request that had history
  // (EZ1-I86 / I87 / I156 / I157).
  const history = (data?.history ?? []) as {
    at: string;
    status?: string;
    byUserId?: string;
    remarks?: string;
  }[];

  const text = (value: unknown) =>
    value === null || value === undefined || value === '' ? '-' : String(value);

  return (
    <div className="space-y-3 rounded-sm border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-gray-900">The record being verified</h4>
        <button className="text-sm text-gray-500 underline" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>

      {!data && <Loading rows={3} />}

      {subject && (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Name">{text(subject.name ?? subject.agencyName)}</Row>
          {/*
            A planner has no category, and the fallback said "Marriage agency"
            — so every planner under review was labelled as something it is
            not. The applicant type is what the queue already knows.
          */}
          <Row label="Category">
            {text(
              subject.otherCategory ??
                subject.category ??
                (applicantType === 'planner'
                  ? 'Wedding planner'
                  : applicantType === 'agent'
                    ? 'Marriage agency'
                    : null),
            )}
          </Row>
          <Row label="City">{text(subject.city)}</Row>
          <Row label="Registered address">
            {text(subject.registeredAddress ?? subject.address)}
          </Row>
          <Row label="Contact number">{text(subject.contactPhone)}</Row>
          <Row label="GST number">{text(subject.gstNumber)}</Row>
          <Row label="PAN">{text(subject.panNumber)}</Row>
          <Row label="Registration number">{text(subject.registrationNumber)}</Row>
          <Row label="Trading since">{text(subject.tradingSince ?? subject.startDate)}</Row>
          <Row label="Currently approved">{subject.isApproved ? 'Yes' : 'No'}</Row>
        </dl>
      )}

      {subject?.description ? (
        <p className="border-t pt-2 text-sm text-gray-700">{String(subject.description)}</p>
      ) : null}

      {/* Portfolio images the business submitted (EZ1-I25). */}
      {Array.isArray(subject?.portfolio) && (subject!.portfolio as string[]).length > 0 && (
        <div className="border-t pt-2">
          <p className="mb-1 text-sm font-medium text-gray-900">Portfolio</p>
          <div className="flex flex-wrap gap-2">
            {(subject!.portfolio as string[]).map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                <img
                  src={url}
                  alt=""
                  className="h-20 w-28 rounded-sm object-cover"
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Compliance documents, as links — an officer checks these before the visit. */}
      {Array.isArray(subject?.complianceDocuments) &&
        (subject!.complianceDocuments as string[]).length > 0 && (
          <div className="border-t pt-2">
            <p className="mb-1 text-sm font-medium text-gray-900">Compliance documents</p>
            <ul className="flex flex-wrap gap-2">
              {(subject!.complianceDocuments as string[]).map((url, i) => (
                <li key={url}>
                  <a className="text-xs text-brand underline" href={url} target="_blank" rel="noreferrer">
                    Document {i + 1}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

      {/* Catalog & services with their priced offerings (EZ1-I25). */}
      {Array.isArray(data?.services) && (data!.services as ServiceSummary[]).length > 0 && (
        <div className="border-t pt-2">
          <p className="mb-1 text-sm font-medium text-gray-900">Catalog &amp; services</p>
          <div className="space-y-2">
            {(data!.services as ServiceSummary[]).map((svc) => (
              <div key={svc.id} className="rounded-sm bg-gray-50 p-2">
                <p className="text-sm font-medium text-gray-800">
                  {svc.definition?.name ?? svc.category?.name ?? 'Service'}
                  {svc.category?.name && svc.definition?.name ? (
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {svc.category.name}
                    </span>
                  ) : null}
                  {!svc.active && (
                    <span className="ml-2 text-xs font-normal text-amber-700">inactive</span>
                  )}
                </p>
                {svc.offerings && svc.offerings.length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
                    {svc.offerings.map((off) => {
                      // A custom-quote / price-on-request offering carries no
                      // amount; it was printing as ₹0 (EZ1-I139). Show the model
                      // instead, and only format a real number.
                      const hasPrice =
                        off.price !== null && off.price !== undefined && Number(off.price) > 0;
                      return (
                        <li key={off.id} className="flex justify-between gap-3">
                          <span>{off.name}</span>
                          <span className="tabular-nums text-gray-600">
                            {hasPrice
                              ? `₹${Number(off.price).toLocaleString('en-IN')}`
                              : off.pricingModel === 'custom_quote'
                                ? 'Custom quote'
                                : 'Price on request'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-gray-400">No offerings priced yet.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/*
        When the listing was sent back for a targeted correction (EZ1-I205), the
        fields the vendor was allowed to change — previous against updated — so
        the officer checks the change rather than taking the resubmission on
        trust. `correctionSnapshot` is what each field held when the correction
        was raised; the value on `subject` is what it holds now.
      */}
      {Array.isArray(subject?.correctionFields) &&
        (subject!.correctionFields as string[]).length > 0 && (
          <div className="border-t pt-2">
            <p className="mb-1 text-sm font-medium text-amber-800">
              Correction requested — previous vs updated
            </p>
            <div className="space-y-1">
              {(subject!.correctionFields as string[]).map((field) => {
                const snapshot =
                  (subject!.correctionSnapshot as Record<string, unknown> | null | undefined) ?? {};
                const before = snapshot[field];
                const after = subject![field];
                const changed = JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
                return (
                  <div
                    key={field}
                    className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5 rounded-sm bg-amber-50 p-2 text-sm sm:grid-cols-[9rem_1fr_1fr]"
                  >
                    <span className="font-medium text-gray-800">
                      {CORRECTION_FIELD_LABELS[field] ?? field}
                    </span>
                    <span className="text-gray-500 line-through">{correctionValue(before)}</span>
                    <span className={changed ? 'font-medium text-gray-900' : 'text-gray-500'}>
                      {correctionValue(after)}
                      {!changed && (
                        <span className="ml-1 text-xs font-normal text-amber-700">(unchanged)</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      {applicant && (
        <p className="border-t pt-2 text-sm text-gray-600">
          Applicant: {text(applicant.email)}
          {applicant.phone ? ` · ${String(applicant.phone)}` : ''}
          {applicant.createdAt
            ? ` · joined ${new Date(String(applicant.createdAt)).toLocaleDateString()}`
            : ''}
        </p>
      )}

      {history.length > 0 && (
        <div className="border-t pt-2">
          <p className="mb-1 text-sm font-medium text-gray-900">History</p>
          <ol className="space-y-1 text-sm text-gray-600">
            {history.map((entry, i) => (
              <li key={i}>
                <span className="text-gray-400">
                  {new Date(entry.at).toLocaleString()} ·{' '}
                </span>
                <span className="capitalize">{(entry.status ?? 'updated').replace(/_/g, ' ')}</span>
                {entry.remarks ? `: ${entry.remarks}` : ''}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** A correction field's value as a short string, for the previous-vs-updated diff. */
function correctionValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : `${value.length} item${value.length === 1 ? '' : 's'}`;
  }
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-gray-800">{children}</dd>
    </div>
  );
}

/**
 * Where an officer will actually travel.
 *
 * Allocation ranked on open workload alone until this existed, which sends the
 * lightest-loaded officer four hundred kilometres to look at a kitchen.
 * Coverage decides the pool and workload decides within it, so an officer with
 * no areas is only ever a fallback — worth being able to see at a glance.
 */
