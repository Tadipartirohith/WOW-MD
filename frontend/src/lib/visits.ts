import { VerificationStatus } from './permissions';

/**
 * A "visit" is a verification request assigned to the officer.
 *
 * There is no separate visits entity — the officer's queue is their list of
 * assigned verification requests, so a visit carries the request's status,
 * city and the 72-hour deadline that stands in for its scheduled time. The
 * shape here is the slice the officer's own screens read; the full request
 * (findings, remarks, allocation basis) lives on the Verification page.
 */
export interface Visit {
  id: string;
  applicantType: string;
  status: VerificationStatus;
  subjectName?: string | null;
  applicantEmail?: string | null;
  applicantPhone?: string | null;
  applicantCity?: string | null;
  /** The 72-hour clock. The nearest thing a request has to a scheduled time. */
  slaDeadline?: string | null;
  createdAt: string;
  verificationStartedAt?: string | null;
}

/** Statuses where the visit is still the officer's to work: not yet decided. */
export const ACTIVE_STATUSES: VerificationStatus[] = [
  'assigned',
  'in_progress',
  'submitted',
  'admin_review',
  'additional_review',
];

export function isActive(v: Visit): boolean {
  return ACTIVE_STATUSES.includes(v.status);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** True when the given ISO timestamp falls on today's date. */
export function isToday(iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return sameDay(d, new Date());
}

/** A visit is "today's" when it is still open and scheduled for today. */
export function isTodayVisit(v: Visit): boolean {
  return isActive(v) && isToday(v.slaDeadline);
}

/** The five headline buckets the officer's Visits screen counts by. */
export interface VisitCounts {
  total: number;
  upcoming: number;
  today: number;
  completed: number;
  cancelled: number;
}

export function countVisits(visits: Visit[]): VisitCounts {
  const counts: VisitCounts = {
    total: visits.length,
    upcoming: 0,
    today: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const v of visits) {
    if (v.status === 'approved') counts.completed += 1;
    else if (v.status === 'rejected') counts.cancelled += 1;
    else if (isActive(v)) {
      if (isToday(v.slaDeadline)) counts.today += 1;
      else counts.upcoming += 1;
    }
  }
  return counts;
}

export type VisitBucket = 'all' | 'upcoming' | 'today' | 'completed' | 'cancelled';

/** Whether a visit belongs to a headline bucket, for the summary-card filter. */
export function inBucket(v: Visit, bucket: VisitBucket): boolean {
  switch (bucket) {
    case 'all':
      return true;
    case 'completed':
      return v.status === 'approved';
    case 'cancelled':
      return v.status === 'rejected';
    case 'today':
      return isTodayVisit(v);
    case 'upcoming':
      return isActive(v) && !isToday(v.slaDeadline);
  }
}

/** Tailwind tone for a status pill, matched to the Verification page. */
export const VISIT_TONE: Record<string, string> = {
  new: 'bg-amber-50 text-amber-800',
  assigned: 'bg-blue-50 text-blue-800',
  in_progress: 'bg-blue-50 text-blue-800',
  submitted: 'bg-sky-50 text-sky-800',
  admin_review: 'bg-sky-50 text-sky-800',
  additional_review: 'bg-amber-50 text-amber-800',
  approved: 'bg-emerald-50 text-emerald-800',
  rejected: 'bg-red-50 text-red-700',
  issue: 'bg-red-50 text-red-700',
};

/** The scheduled time as a short, local string, or a dash when unset. */
export function scheduledLabel(iso?: string | null): string {
  if (!iso) return 'Unscheduled';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unscheduled';
  return d.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
