import { ReactNode, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import {
  CaseStatus,
  MILESTONE_LABEL,
  Permission,
  VERIFICATION_LABEL,
  VerificationStatus,
  can,
} from '../lib/permissions';

interface VerificationRequest {
  id: string;
  applicantType: string;
  applicantUserId: string;
  subjectId: string | null;
  status: VerificationStatus;
  assignedToUserId: string | null;
  remarks: string | null;
  createdAt: string;
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
  const canManageOfficers = can(permissions, Permission.ADMIN_OFFICER_MANAGE);

  const [tab, setTab] = useState<'requests' | 'cases' | 'officers'>('requests');
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
        <h1 className="text-xl font-bold text-brand-dark">Verification</h1>
        <p className="text-sm text-gray-600">
          Agents and vendors are visited before they are activated. Nothing on this platform is
          approved from a form alone.
        </p>
      </div>

      {error && <p className="rounded bg-red-50 p-3 text-sm text-red-600">{error}</p>}
      {notice && <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

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
          {rows.length === 0 && <p className="card text-sm text-gray-500">Nothing in the queue.</p>}
          {rows.map((r) => (
            <RequestRow
              key={r.id}
              request={r}
              officers={activeOfficers}
              canAllocate={canAllocate}
              canDecide={canDecide}
              onRun={run}
            />
          ))}
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
      className={`rounded px-3 py-1.5 text-sm ${
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
  onRun,
}: {
  request: VerificationRequest;
  officers: Officer[];
  canAllocate: boolean;
  canDecide: boolean;
  onRun: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const [officerUserId, setOfficerUserId] = useState('');
  const [remarks, setRemarks] = useState('');
  const decided = request.status === 'approved' || request.status === 'rejected';

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium capitalize">{request.applicantType} verification</p>
          <p className="text-xs text-gray-500">
            Raised {new Date(request.createdAt).toLocaleDateString()}
          </p>
        </div>
        <Pill status={request.status} />
      </div>

      {request.remarks && (
        <p className="rounded bg-gray-50 p-2 text-sm text-gray-700">{request.remarks}</p>
      )}

      <SubjectDetails requestId={request.id} />

      {canAllocate && !decided && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="text-gray-700">Allocate to</span>
            <select
              className="input mt-1"
              value={officerUserId}
              onChange={(e) => setOfficerUserId(e.target.value)}
            >
              <option value="">Lightest workload (recommended)</option>
              {officers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {typeof o.openCount === 'number' ? ` — ${o.openCount} open` : ''}
                </option>
              ))}
            </select>
          </label>
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

      {canDecide && !decided && (
        <div className="space-y-2 border-t pt-3">
          {request.status === 'assigned' && (
            <button
              className="btn-outline"
              onClick={() => onRun(() => api.put(`/verification/requests/${request.id}/start`))}
            >
              Start the visit
            </button>
          )}
          <textarea
            className="input"
            rows={2}
            placeholder="What you found on the visit. Required for anything other than an approval."
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
                onRun(() =>
                  api.put(`/verification/requests/${request.id}/decide`, {
                    status: 'additional_review',
                    remarks,
                  }),
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
        </div>
      )}
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
        <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">
          Escalated — this one needs somebody on the ground.
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
          <label className="text-sm">
            <span className="text-gray-700">Allocate to</span>
            <select
              className="input mt-1"
              value={officerUserId}
              onChange={(e) => setOfficerUserId(e.target.value)}
            >
              <option value="">Lightest workload (recommended)</option>
              {officers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {typeof o.openCount === 'number' ? ` — ${o.openCount} open` : ''}
                </option>
              ))}
            </select>
          </label>
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

          <div className="rounded bg-gray-50 p-3">
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
          <h2 className="font-semibold text-gray-900">Add a verification officer</h2>
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
        <h2 className="mb-2 font-semibold text-gray-900">Officers</h2>
        {officers.length === 0 && <p className="text-sm text-gray-500">None yet.</p>}
        {officers.map((o) => (
          <div
            key={o.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0"
          >
            <div>
              <p className="font-medium">{o.name}</p>
              <p className="text-xs text-gray-500">{o.email}</p>
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
 * What is actually being verified.
 *
 * The queue used to show a request id and an applicant type, which tells an
 * officer nothing about where to go or what to check. This is the record the
 * decision is about — the business or agency as the applicant filled it in —
 * plus every hand the request has passed through, so an approval can be read
 * back later and understood.
 */
function SubjectDetails({ requestId }: { requestId: string }) {
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
    value === null || value === undefined || value === '' ? '—' : String(value);

  return (
    <div className="space-y-3 rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-gray-900">The record being verified</h4>
        <button className="text-sm text-gray-500 underline" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>

      {!data && <p className="text-sm text-gray-400">Loading…</p>}

      {subject && (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Name">{text(subject.name ?? subject.agencyName)}</Row>
          <Row label="Category">
            {text(subject.otherCategory ?? subject.category ?? 'Marriage agency')}
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
                {entry.note ? ` — ${entry.note}` : ''}
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
