import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { WarningCircle, X } from '@phosphor-icons/react';
import { api } from '../lib/api';

interface MyVerification {
  id: string | null;
  applicantType: string | null;
  status: string | null;
  remarks: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
}

const DISMISS_KEY = 'wow:planner-rejection-dismissed';

/**
 * A planner whose registration was rejected is told plainly, the moment they
 * are in the app (EZ1-I110).
 *
 * The Rejected state already shows on the My Business page, but a planner does
 * not necessarily open that page — the decision reached them only in the
 * Notifications feed, which is easy to miss. This is the pop-up that surfaces
 * the same server answer on login: the status, the administrator's reason, when
 * it was decided, and what was reviewed.
 *
 * Dismissal is keyed on the decision timestamp, so closing it does not silence
 * a *later* rejection — a fresh decision re-opens it — while a rejection the
 * planner has already read stays closed.
 */
export default function PlannerRejectionModal() {
  const { data } = useQuery({
    queryKey: ['my-verification'],
    queryFn: async () => (await api.get('/verification/me')).data as MyVerification,
    retry: false,
  });

  const rejected = data?.status === 'rejected';
  // The decision timestamp identifies this rejection; a resubmission that is
  // rejected again has a new one and so re-opens the pop-up.
  const marker = data?.decidedAt ?? data?.id ?? '';

  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === marker && Boolean(marker);
    } catch {
      return false;
    }
  });

  if (!rejected || dismissed) return null;

  function close() {
    try {
      if (marker) localStorage.setItem(DISMISS_KEY, marker);
    } catch {
      /* a private window without storage still gets the in-memory close */
    }
    setDismissed(true);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-scrim/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="planner-rejection-title"
    >
      <div className="my-8 w-full max-w-md rounded-lg bg-surface p-6 shadow-card">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-red-50 text-red-600">
              <WarningCircle size={22} weight="fill" aria-hidden />
            </span>
            <div>
              <h2 id="planner-rejection-title" className="section-title text-red-800">
                Registration rejected
              </h2>
              <p className="text-xs text-gray-500">Your wedding planner verification</p>
            </div>
          </div>
          <button
            className="text-gray-400 hover:text-gray-700"
            onClick={close}
            aria-label="Close"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <p className="text-sm text-gray-700">
          An administrator reviewed your registration and could not approve it. Your listing stays
          out of search, and the account cannot be submitted for verification again until the
          decision is reviewed.
        </p>

        {data?.remarks && (
          <div className="mt-3 rounded-sm border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-red-700">
              Reason given
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-red-900">{data.remarks}</p>
          </div>
        )}

        <dl className="mt-3 space-y-1 text-sm">
          {data?.decidedAt && (
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Decided</dt>
              <dd className="text-gray-800">{new Date(data.decidedAt).toLocaleString()}</dd>
            </div>
          )}
          {data?.submittedAt && (
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Submitted</dt>
              <dd className="text-gray-800">{new Date(data.submittedAt).toLocaleString()}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-gray-500">Reviewed</dt>
            <dd className="text-gray-800">Wedding planner registration</dd>
          </div>
        </dl>

        <div className="mt-5 flex gap-2">
          <Link className="btn flex-1" to="/console" onClick={close}>
            View details
          </Link>
          <Link className="btn-outline" to="/support" onClick={close}>
            Contact support
          </Link>
        </div>
      </div>
    </div>
  );
}
