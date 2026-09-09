import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import PhotoUploader from '../components/PhotoUploader';
import { formatDateTime } from '../lib/dates';
import { Loading } from '../components/ui/Feedback';
import { useAuth } from '../store/auth';
import { CASE_ACTION_LABEL, isProvider } from '../lib/permissions';

interface SupportCase {
  id: string;
  subjectType: string;
  subjectId: string | null;
  title: string;
  description: string;
  status: string;
  evidence?: string[];
  createdAt: string;
  history?: { at: string; byUserId: string; status: string; remarks?: string }[];
  /** The officer's investigation and the resolution, once there is one (EZ1-I49). */
  findings?: string | null;
  settlementOutcome?: string | null;
  settlementNotes?: string | null;
  /** The category-specific action the case was resolved with (EZ1-I181). */
  resolutionAction?: string | null;
  resolvedAt?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  triaged: 'Triaged',
  allocated: 'With an investigator',
  in_progress: 'Being looked into',
  waiting_for_information: 'Waiting on you',
  resolution_submitted: 'Resolution in review',
  admin_review: 'Resolution in review',
  reassigned: 'Sent for another look',
  resolved: 'Resolved',
  rejected: 'Closed, no action',
  escalated: 'Escalated for a visit',
  closed: 'Closed',
};

const STATUS_TONE: Record<string, string> = {
  open: 'bg-amber-50 text-amber-800',
  triaged: 'bg-sky-50 text-sky-800',
  allocated: 'bg-sky-50 text-sky-800',
  in_progress: 'bg-sky-50 text-sky-800',
  waiting_for_information: 'bg-amber-50 text-amber-800',
  resolution_submitted: 'bg-sky-50 text-sky-800',
  admin_review: 'bg-sky-50 text-sky-800',
  reassigned: 'bg-amber-50 text-amber-800',
  resolved: 'bg-emerald-50 text-emerald-800',
  rejected: 'bg-gray-100 text-gray-600',
  escalated: 'bg-red-50 text-red-700',
  closed: 'bg-gray-100 text-gray-600',
};

const OUTCOME_LABEL: Record<string, string> = {
  release: 'Released to the provider',
  refund: 'Refunded to the customer',
  partial: 'Partially settled',
  no_action: 'No action needed',
};

/**
 * Somewhere to say something has gone wrong.
 *
 * Vendors had nowhere at all: an argument about a booking could only be raised
 * from inside that booking, and anything else — a listing that will not
 * verify, a payout that has not arrived, a client behaving badly — had no
 * route into the platform except email.
 *
 * Raising a case against a booking freezes any escrow held on it, so the
 * subject is asked for deliberately rather than inferred: freezing somebody's
 * money by accident is not a small mistake.
 */
export default function Support() {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [raising, setRaising] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const { data: cases, isLoading } = useQuery({
    queryKey: ['support-cases'],
    queryFn: async () => (await api.get('/verification/cases')).data,
    retry: false,
  });

  const rows: SupportCase[] = cases?.data ?? [];
  const live = rows.filter((c) => !['resolved', 'rejected', 'closed'].includes(c.status));
  const done = rows.filter((c) => ['resolved', 'rejected', 'closed'].includes(c.status));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="page-title">Support</h1>
          <p className="page-subtitle">
            Anything that has gone wrong. A booking, a payment, a listing that will not verify.
            Somebody reads every one of these.
          </p>
        </div>
        <button className="btn" onClick={() => setRaising(!raising)}>
          {raising ? 'Cancel' : 'Raise an issue'}
        </button>
      </div>

      {error && <p className="alert-critical">{error}</p>}
      {notice && <p className="alert-positive">{notice}</p>}

      {raising && (
        <RaiseCase
          onDone={async (message) => {
            setError('');
            setNotice(message);
            setRaising(false);
            await qc.invalidateQueries({ queryKey: ['support-cases'] });
          }}
          onError={(message) => {
            setNotice('');
            setError(message);
          }}
        />
      )}

      {isLoading && <Loading rows={3} />}

      {!isLoading && rows.length === 0 && !raising && (
        <p className="card text-sm text-gray-400">
          Nothing raised. That is the state you want to be in.
        </p>
      )}

      {live.length > 0 && (
        <Section title="Open" cases={live} open={open} setOpen={setOpen} />
      )}
      {done.length > 0 && (
        <Section title="Closed" cases={done} open={open} setOpen={setOpen} />
      )}
    </div>
  );
}

function Section({
  title,
  cases,
  open,
  setOpen,
}: {
  title: string;
  cases: SupportCase[];
  open: string | null;
  setOpen: (id: string | null) => void;
}) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        {title} ({cases.length})
      </h2>
      <div className="card divide-y p-0">
        {cases.map((c) => (
          <div key={c.id} className="p-4">
            <button
              className="flex w-full flex-wrap items-start justify-between gap-2 text-left"
              onClick={() => setOpen(open === c.id ? null : c.id)}
            >
              <span className="min-w-0">
                <span className="block font-medium text-gray-900">{c.title}</span>
                <span className="block text-xs text-gray-500">
                  {c.subjectType.replace(/_/g, ' ')} · raised {formatDateTime(c.createdAt)}
                </span>
              </span>
              <span
                className={`shrink-0 rounded-full px-2 py-1 text-xs ${
                  STATUS_TONE[c.status] ?? 'bg-gray-100 text-gray-600'
                }`}
              >
                {STATUS_LABEL[c.status] ?? c.status.replace(/_/g, ' ')}
              </span>
            </button>

            {open === c.id && (
              <div className="mt-3 space-y-2 border-t pt-3 text-sm">
                <p className="whitespace-pre-wrap text-gray-700">{c.description}</p>
                {/* The officer's findings and the resolution, once submitted, so
                    the vendor can see the answer rather than only the status
                    word (EZ1-I49). */}
                {(c.findings || c.settlementOutcome || c.settlementNotes || c.resolutionAction) && (
                  <div className="rounded-sm border border-emerald-200 bg-emerald-50 p-2">
                    <p className="text-xs font-medium text-emerald-900">
                      Resolution{c.resolvedAt ? ` · ${formatDateTime(c.resolvedAt)}` : ''}
                    </p>
                    {c.resolutionAction && (
                      <p className="mt-0.5 text-sm font-medium text-emerald-900">
                        {CASE_ACTION_LABEL[c.resolutionAction] ?? c.resolutionAction.replace(/_/g, ' ')}
                      </p>
                    )}
                    {c.settlementOutcome && (
                      <p className="mt-0.5 text-sm text-emerald-900">
                        {OUTCOME_LABEL[c.settlementOutcome] ?? c.settlementOutcome.replace(/_/g, ' ')}
                      </p>
                    )}
                    {c.findings && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-emerald-900">
                        {c.findings}
                      </p>
                    )}
                    {c.settlementNotes && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-emerald-900">
                        {c.settlementNotes}
                      </p>
                    )}
                  </div>
                )}
                {c.evidence && c.evidence.length > 0 && (
                  <p className="flex flex-wrap gap-2">
                    {c.evidence.map((url, i) => (
                      <a
                        key={url}
                        className="text-xs text-brand underline"
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Attachment {i + 1}
                      </a>
                    ))}
                  </p>
                )}
                {c.history && c.history.length > 0 && (
                  <ol className="space-y-1 border-l-2 border-gray-200 pl-3">
                    {c.history.map((h, i) => (
                      <li key={i} className="text-xs text-gray-600">
                        <span className="font-medium text-gray-800">
                          {STATUS_LABEL[h.status] ?? h.status.replace(/_/g, ' ')}
                        </span>{' '}
                        · {formatDateTime(h.at)}
                        {h.remarks ? `: ${h.remarks}` : ''}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * What a case can be raised about, and who it is offered to (EZ1-I149).
 *
 * `audience` narrows a category to the people it makes sense for: a vendor's
 * complaints are about their listing, availability and payouts, never about a
 * match or a matchmaking profile — those belong to the couples and agents on
 * the other side of the marketplace. `undefined` means everyone sees it.
 * Staff (officers, admins) see the full list so they can raise on any subject.
 */
type Audience = 'provider' | 'seeker';
const SUBJECTS: { value: string; label: string; hint?: string; audience?: Audience[] }[] = [
  {
    value: 'booking',
    label: 'A booking',
    hint: 'Any money held on it is frozen until this is settled.',
  },
  { value: 'payment', label: 'A payment or payout' },
  { value: 'vendor', label: 'My business listing', audience: ['provider'] },
  { value: 'availability', label: 'Availability', audience: ['provider'] },
  { value: 'profile', label: 'A profile', audience: ['seeker'] },
  { value: 'match', label: 'A match', audience: ['seeker'] },
  { value: 'account', label: 'My account' },
  { value: 'other', label: 'Something else' },
];

function subjectsFor(role?: string) {
  const provider = isProvider(role);
  const seeker = role === 'bride' || role === 'groom' || role === 'family' || role === 'agent';
  return SUBJECTS.filter((s) => {
    if (!s.audience) return true;
    if (provider) return s.audience.includes('provider');
    if (seeker) return s.audience.includes('seeker');
    // Staff and anyone unclassified see everything.
    return true;
  });
}

function RaiseCase({
  onDone,
  onError,
}: {
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const role = useAuth((s) => s.user?.role);
  const subjects = subjectsFor(role);
  const [subjectType, setSubjectType] = useState('other');
  const [subjectId, setSubjectId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const subject = subjects.find((s) => s.value === subjectType);
  const needsSubject = subjectType === 'booking' || subjectType === 'payment';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/verification/cases', {
        subjectType,
        subjectId: subjectId.trim() || undefined,
        title: title.trim(),
        description: description.trim(),
        evidence: evidence.length > 0 ? evidence : undefined,
      });
      onDone('Raised. You will see it move through the stages here.');
      setTitle('');
      setDescription('');
      setSubjectId('');
      setEvidence([]);
    } catch (err) {
      onError(apiMessage(err, 'That could not be raised.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-medium text-gray-700">What is it about?</span>
          <select
            className="input mt-1"
            value={subjectType}
            onChange={(e) => {
              setSubjectType(e.target.value);
              setSubjectId('');
            }}
          >
            {subjects.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {subject?.hint && (
            <span className="mt-1 block text-xs text-amber-700">{subject.hint}</span>
          )}
        </label>
        {needsSubject && (
          <label className="text-sm">
            <span className="font-medium text-gray-700">Which one?</span>
            <input
              className="input mt-1"
              placeholder="Booking reference"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
            />
            <span className="mt-1 block text-xs text-gray-500">
              The reference on the booking. Leave it blank if you are not sure.
            </span>
          </label>
        )}
      </div>

      <label className="block text-sm">
        <span className="font-medium text-gray-700">In one line</span>
        <input
          className="input mt-1"
          minLength={5}
          maxLength={200}
          placeholder="The hall we were shown is not the hall we were given"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium text-gray-700">What happened?</span>
        <textarea
          className="input mt-1"
          rows={4}
          minLength={10}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
        <span className="mt-1 block text-xs text-gray-500">
          Dates, names, amounts. An investigation run on two sentences is a coin toss.
        </span>
      </label>

      <div className="text-sm">
        <span className="font-medium text-gray-700">Anything you can show us</span>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {evidence.map((url, i) => (
            <span key={url} className="flex items-center gap-1 rounded-sm bg-gray-100 px-2 py-1 text-xs">
              Attachment {i + 1}
              <button
                type="button"
                className="text-gray-500 hover:text-red-600"
                onClick={() => setEvidence(evidence.filter((e) => e !== url))}
              >
                ×
              </button>
            </span>
          ))}
          {evidence.length < 10 && (
            <PhotoUploader
              kind="attachment"
              label="Attach"
              onUploaded={(url) => setEvidence([...evidence, url])}
            />
          )}
        </div>
      </div>

      <button className="btn" disabled={busy}>
        {busy ? 'Raising…' : 'Raise it'}
      </button>
    </form>
  );
}
