import { ReactNode, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import { Loading } from '../components/ui/Feedback';
import {
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

interface SupportCase {
  id: string;
  subjectType: string;
  subjectId: string | null;
  title: string;
  description: string;
  status: CaseStatus;
  assignedToUserId: string | null;
  findings: string | null;
  settlementOutcome: string | null;
  /** Which instalment the argument is over; null when it is not about money. */
  milestone: string | null;
  evidence: string[];
  requiresPhysicalVerification: boolean;
  createdAt: string;
}

interface Officer {
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
}: {
  officers: Officer[];
  value: string;
  onChange: (id: string) => void;
}) {
  // Verification is official work: only a Verification Officer may be allocated
  // a request, never a commercial agent (EZ1-I22). Agents are filtered out of
  // the roster here rather than shown and refused later.
  const eligible = officers.filter((o) => (o.kind ?? 'officer') === 'officer');

  return (
    <label className="text-sm">
      <span className="text-gray-700">Allocate to</span>
      <select className="input mt-1" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Lightest workload (recommended)</option>
        {eligible.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
            {typeof o.openCount === 'number' ? `: ${o.openCount} open` : ''}
          </option>
        ))}
      </select>
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

  const [tab, setTab] = useState<'requests' | 'cases' | 'officers'>('requests');
  // Null shows every section at once, which is what somebody with four visits
  // wants; picking one is for somebody with forty.
  const [section_, setSection] = useState<string | null>(null);
  const visibleSections = section_ ? SECTIONS.filter((x) => x.key === section_) : SECTIONS;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const { data: metrics } = useQuery({
    queryKey: ['verification-metrics'],
    queryFn: async () => (await api.get('/verification/metrics')).data,
    retry: false,
  });

  const { data: requests } = useQuery({
    queryKey: ['verification-requests'],
    queryFn: async () => (await api.get('/verification/requests')).data,
    retry: false,
  });

  const { data: cases } = useQuery({
    queryKey: ['verification-cases'],
    queryFn: async () => (await api.get('/verification/cases')).data,
    retry: false,
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
      }[],
    retry: false,
    enabled: canAllocate,
  });

  const officersWithLoad: Officer[] = (officers ?? []).map((o) => ({
    ...o,
    openCount: workload.find((w) => w.officerUserId === o.id)?.open ?? 0,
  }));

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

      {metrics && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Waiting" value={metrics.requests?.new ?? 0} />
          <Metric label="In progress" value={metrics.requests?.in_progress ?? 0} />
          <Metric label="Approved" value={metrics.requests?.approved ?? 0} />
          <Metric label="Open cases" value={metrics.cases?.open ?? 0} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === 'requests'} onClick={() => setTab('requests')}>
          Visits ({rows.length})
        </TabButton>
        <TabButton active={tab === 'cases'} onClick={() => setTab('cases')}>
          Cases ({caseRows.length})
        </TabButton>
        {canManageOfficers && (
          <TabButton active={tab === 'officers'} onClick={() => setTab('officers')}>
            Officers ({officers?.length ?? 0})
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
            const sectionRows = rows.filter((r) => section.statuses.includes(r.status));
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

      {tab === 'cases' && (
        <div className="space-y-3">
          {caseRows.length === 0 && <p className="card text-sm text-gray-500">No open cases.</p>}
          {caseRows.map((c) => (
            <CaseRow
              key={c.id}
              item={c}
              officers={activeOfficers}
              canAllocate={canAllocate}
              onRun={run}
            />
          ))}
        </div>
      )}

      {tab === 'officers' && canManageOfficers && (
        <OfficersPanel officers={officers ?? []} onRun={run} />
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
    </div>
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
    </div>
  );
}

const RECOMMENDATION_LABEL: Record<string, string> = {
  approve: 'approval',
  reject: 'rejection',
  revisit: 'another visit',
};

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

function CaseRow({
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
  const settled = item.status === 'resolved' || item.status === 'closed';

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{item.title}</p>
          <p className="text-xs capitalize text-gray-500">
            {item.subjectType} · raised {new Date(item.createdAt).toLocaleDateString()}
          </p>
        </div>
        <Pill status={item.status} />
      </div>

      <p className="text-sm text-gray-700">{item.description}</p>

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

      {item.settlementOutcome && (
        <p className="text-sm text-gray-600">
          Settled: <span className="font-medium">{item.settlementOutcome.replace(/_/g, ' ')}</span>
        </p>
      )}

      {canAllocate && !settled && (
        <div className="flex flex-wrap items-end gap-2">
          <AllocateePicker
            officers={officers}
            value={officerUserId}
            onChange={setOfficerUserId}
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

      {!settled && (
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

          <div className="rounded-sm bg-gray-50 p-3">
            <p className="text-sm font-medium text-gray-800">Settlement</p>
            <p className="mb-2 text-xs text-gray-600">
              Money on the disputed booking is frozen until one of these is recorded.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <button
                className="btn"
                onClick={() =>
                  onRun(
                    () =>
                      api.put(`/verification/cases/${item.id}/settle`, { outcome: 'release' }),
                    'Released to the provider.',
                  )
                }
              >
                Release to provider
              </button>
              <button
                className="btn-outline"
                onClick={() =>
                  onRun(
                    () => api.put(`/verification/cases/${item.id}/settle`, { outcome: 'refund' }),
                    'Refunded to the buyer.',
                  )
                }
              >
                Refund the buyer
              </button>
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
                  onRun(() =>
                    api.put(`/verification/cases/${item.id}/settle`, {
                      outcome: 'partial',
                      amount: Number(amount),
                    }),
                  )
                }
              >
                Settle partially
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OfficersPanel({
  officers,
  onRun,
}: {
  officers: Officer[];
  onRun: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <h2 className="section-title">Add a verification officer</h2>
          <p className="text-sm text-gray-600">
            There is no sign-up for this role. The account is created here and the credentials are
            emailed; the officer replaces the password on first sign-in.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            className="input"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="input"
            placeholder="Area covered"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          />
        </div>
        <button
          className="btn"
          disabled={!email || name.length < 2}
          onClick={() =>
            onRun(async () => {
              await api.post('/verification/officers', {
                email,
                name,
                region: region || undefined,
              });
              setEmail('');
              setName('');
              setRegion('');
            }, 'Officer created. Their credentials are on the way.')
          }
        >
          Create officer
        </button>
      </div>

      <div className="card">
        <h2 className="section-title mb-2">Officers</h2>
        {officers.length === 0 && <p className="text-sm text-gray-500">None yet.</p>}
        {officers.map((o) => (
          <div
            key={o.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0"
          >
            <div className="min-w-0">
              <p className="font-medium">{o.name}</p>
              <p className="text-xs text-gray-500">{o.email}</p>
              <ServiceAreas officerId={o.id} onRun={onRun} />
            </div>
            <button
              className="btn-outline"
              onClick={() =>
                onRun(() =>
                  api.put(`/verification/officers/${o.id}/status`, { isActive: !o.isActive }),
                )
              }
            >
              {o.isActive ? 'Suspend' : 'Restore'}
            </button>
          </div>
        ))}
      </div>
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
  const history = (data?.history ?? []) as {
    at: string;
    action: string;
    byUserId?: string;
    note?: string;
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
          <Row label="Trading since">{text(subject.startDate)}</Row>
          <Row label="Currently approved">{subject.isApproved ? 'Yes' : 'No'}</Row>
        </dl>
      )}

      {subject?.description ? (
        <p className="border-t pt-2 text-sm text-gray-700">{String(subject.description)}</p>
      ) : null}

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
                <span className="capitalize">{entry.action.replace(/_/g, ' ')}</span>
                {entry.note ? `: ${entry.note}` : ''}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
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
function ServiceAreas({
  officerId,
  onRun,
}: {
  officerId: string;
  onRun: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [place, setPlace] = useState('');
  const [scope, setScope] = useState<'city' | 'state'>('city');
  const [primary, setPrimary] = useState(true);

  const { data: areas = [] } = useQuery<
    { id: string; label: string; city: string | null; state: string | null; primary: boolean }[]
  >({
    queryKey: ['officer-areas', officerId],
    queryFn: async () => (await api.get(`/verification/officers/${officerId}/areas`)).data,
    retry: false,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['officer-areas', officerId] });

  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-1">
        {areas.map((a) => (
          <span
            key={a.id}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
              a.primary ? 'bg-brand/10 text-brand' : 'bg-gray-100 text-gray-600'
            }`}
            title={a.state && !a.city ? 'Whole state' : a.primary ? 'Primary area' : 'Will travel'}
          >
            {a.label}
            {a.state && !a.city ? ' (state)' : ''}
            <button
              type="button"
              className="text-gray-400 hover:text-red-600"
              onClick={() =>
                onRun(async () => {
                  await api.delete(`/verification/areas/${a.id}`);
                  await refresh();
                })
              }
            >
              ×
            </button>
          </span>
        ))}
        {areas.length === 0 && (
          <span className="text-xs text-amber-700">
            Covers nowhere, only allocated when nobody else fits
          </span>
        )}
        <button
          type="button"
          className="text-xs text-brand underline"
          onClick={() => setAdding(!adding)}
        >
          {adding ? 'cancel' : '+ area'}
        </button>
      </div>

      {adding && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!place.trim()) return;
            void onRun(async () => {
              await api.post(`/verification/officers/${officerId}/areas`, {
                [scope]: place.trim(),
                primary,
              });
              await refresh();
              setPlace('');
              setAdding(false);
            }, 'Coverage added.');
          }}
        >
          <select
            className="input w-28 text-sm"
            value={scope}
            onChange={(e) => setScope(e.target.value as 'city' | 'state')}
          >
            <option value="city">City</option>
            <option value="state">State</option>
          </select>
          <input
            className="input w-44 text-sm"
            placeholder={scope === 'city' ? 'Hyderabad' : 'Telangana'}
            value={place}
            onChange={(e) => setPlace(e.target.value)}
          />
          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input
              type="checkbox"
              className="h-3 w-3"
              checked={primary}
              onChange={(e) => setPrimary(e.target.checked)}
            />
            Primary
          </label>
          <button className="btn-outline text-sm">Add</button>
        </form>
      )}
    </div>
  );
}
