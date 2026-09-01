import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Circle, LockSimple, Warning } from '@phosphor-icons/react';
import { api, apiMessage } from '../lib/api';

/**
 * Getting a business from a blank form to live, as one visible sequence.
 *
 * Every part of this already existed on the server — completion() works out
 * what is filled in, beginFirstReview() and submitForVerification() walk the
 * state machine, and the update routes refuse edits once a listing is locked.
 * None of it was reachable. A vendor filled in a form, pressed Save, and was
 * told an officer would visit; whether anything else was required, what was
 * missing, and what happened next were not on the screen at all.
 *
 * So this is wiring rather than invention, and the shape follows the server's
 * answer rather than restating it: the checklist is `completion().items`, the
 * button is enabled by `canSubmit`, and the lock is `rules.editIdentity`. A
 * second copy of those rules here would be a second thing to keep in step, and
 * it would be the copy that is wrong.
 */

export type BusinessStatus =
  | 'draft'
  | 'ready_for_review'
  | 'first_review'
  | 'pending_verification'
  | 'verification_in_progress'
  | 'verified'
  | 'live'
  | 'reverification_required'
  | 'rejected';

interface CompletionItem {
  key: string;
  label: string;
  complete: boolean;
  /** What is still needed, or a note when the item is optional. */
  missing: string | null;
}

export interface Completion {
  businessId: string;
  status: BusinessStatus;
  rules: {
    editIdentity: boolean;
    editCatalog: boolean;
    trade: boolean;
    submit: boolean;
    visible: boolean;
    note: string;
  };
  items: CompletionItem[];
  canSubmit: boolean;
  blocking: string[];
}

/** What each state means to the person in it, rather than its enum name. */
const STATUS_LABEL: Record<BusinessStatus, string> = {
  draft: 'Draft',
  ready_for_review: 'Ready for your review',
  first_review: 'Your review',
  pending_verification: 'Waiting for a verification officer',
  verification_in_progress: 'Officer visiting',
  verified: 'Verified',
  live: 'Live',
  reverification_required: 'Sent back for changes',
  rejected: 'Refused',
};

const STATUS_TONE: Record<BusinessStatus, string> = {
  draft: 'bg-surface-sunken text-gray-700',
  ready_for_review: 'bg-caution-bg text-caution-fg',
  first_review: 'bg-caution-bg text-caution-fg',
  pending_verification: 'bg-brand-soft text-brand-strong',
  verification_in_progress: 'bg-brand-soft text-brand-strong',
  verified: 'bg-positive-bg text-positive-fg',
  live: 'bg-positive-bg text-positive-fg',
  reverification_required: 'bg-caution-bg text-caution-fg',
  rejected: 'bg-critical-bg text-critical-fg',
};

export function useCompletion(businessId?: string) {
  return useQuery({
    queryKey: ['business-completion', businessId],
    queryFn: async () => (await api.get(`/vendors/${businessId}/completion`)).data as Completion,
    enabled: Boolean(businessId),
    retry: false,
  });
}

export default function BusinessSetup({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const { data, isPending } = useCompletion(businessId);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['business-completion'] });
    void qc.invalidateQueries({ queryKey: ['my-listing'] });
    void qc.invalidateQueries({ queryKey: ['businesses'] });
  };

  const review = useMutation({
    mutationFn: () => api.post(`/vendors/${businessId}/first-review`),
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: (err) => setError(apiMessage(err, 'That could not be opened for review.')),
  });

  const submit = useMutation({
    mutationFn: () => api.post(`/vendors/${businessId}/submit-verification`),
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: (err) => setError(apiMessage(err, 'That could not be submitted.')),
  });

  if (isPending || !data) return null;

  const { status, rules, items, canSubmit } = data;
  const inReview = status === 'first_review';
  const submitted = !rules.submit && !rules.editIdentity;

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="section-title">Getting this listing live</h2>
          <p className="text-sm text-gray-600">{rules.note}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[status]}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      {error && <p className="alert-critical">{error}</p>}

      {/*
        The checklist is the server's, item for item. It is computed on every
        read rather than tracked, so removing a document takes its tick away
        again — a "documents complete" flag somebody forgot to clear is worse
        than no flag, because it lets an unfinished listing through the gate.
      */}
      <ul className="divide-y divide-gray-200">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-3 py-2.5">
            {item.complete ? (
              <CheckCircle
                size={18}
                weight="fill"
                className="mt-0.5 shrink-0 text-positive-fg"
                aria-label="Done"
              />
            ) : (
              <Circle size={18} className="mt-0.5 shrink-0 text-gray-300" aria-label="Not done" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">{item.label}</p>
              {item.missing && <p className="text-xs text-gray-500">{item.missing}</p>}
            </div>
          </li>
        ))}
      </ul>

      {/*
        Two steps, and they are different questions. The first review is the
        vendor reading their own listing while they can still change it; the
        submission is the moment it locks and an officer is sent. Collapsing
        them into one button would make the review a confirmation dialog.
      */}
      {rules.submit && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3">
          {!inReview ? (
            <button
              className="btn"
              disabled={!canSubmit || review.isPending}
              title={canSubmit ? undefined : `Finish these first: ${data.blocking.join(', ')}`}
              onClick={() => review.mutate()}
            >
              Look it over
            </button>
          ) : (
            <>
              <button
                className="btn"
                disabled={!canSubmit || submit.isPending}
                onClick={() => submit.mutate()}
              >
                Submit for verification
              </button>
              <span className="text-xs text-gray-500">
                It locks when you do. An officer visits the registered address.
              </span>
            </>
          )}
          {!canSubmit && data.blocking.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-caution-fg">
              <Warning size={14} weight="fill" aria-hidden />
              Still needed: {data.blocking.join(', ')}
            </span>
          )}
        </div>
      )}

      {submitted && (
        <p className="flex items-start gap-2 border-t border-gray-200 pt-3 text-sm text-gray-600">
          <LockSimple size={16} className="mt-0.5 shrink-0 text-gray-400" aria-hidden />
          {/*
            The lock is the server's, not this screen's. A vendor who could edit
            their GST number after an officer had been sent to check it would
            have verified nothing, so the update routes refuse it — this only
            says so.
          */}
          Locked while it is being verified. It opens again if it is sent back for changes.
        </p>
      )}
    </div>
  );
}
