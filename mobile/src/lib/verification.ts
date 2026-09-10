import type { Tone } from '@/components/chrome';
import type { CaseStatus, VerificationStatus } from '@/shared/permissions';

/**
 * The in-person verification portal's records and the way its queue sorts.
 *
 * Copied from the web client's Verification.tsx, which holds all of it in one
 * 2,200-line component. The section blurbs in particular are kept word for
 * word: "Parked on something that has to be resolved elsewhere" is what an
 * officer learns the Issues bucket means, and rewording it here would make the
 * two products disagree about what a bucket is for.
 */

/** What an officer wrote up after attending. */
export interface VerificationFindings {
  visited: boolean;
  observations: string;
  issues: string[];
  evidence: string[];
  recommendation: 'approve' | 'reject' | 'revisit';
}

export interface VerificationRequest {
  id: string;
  applicantType: string;
  applicantUserId: string;
  subjectId: string | null;
  status: VerificationStatus;
  assignedToUserId: string | null;
  remarks: string | null;
  createdAt: string;
  findings: VerificationFindings | null;
  /** When the officer filed the findings, for the submitted card. */
  submittedAt?: string | null;
  revisitCount: number;
  /** What the automatic allocation went on. Absent on an older request. */
  allocationBasis?: string | null;
  applicantCity?: string | null;
  applicantEmail?: string | null;
  applicantPhone?: string | null;
  subjectName?: string | null;
  /** The 72-hour clock, computed and stored on the server. */
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
  /** The category-specific action the officer resolved with. */
  resolutionAction?: string | null;
  /** Which instalment the argument is over; null when it is not about money. */
  milestone: string | null;
  evidence: string[];
  requiresPhysicalVerification: boolean;
  createdAt: string;
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
  payments?:
    | {
        milestone: string;
        status: string;
        amount: string;
        payoutAmount: string;
        payoutNote: string | null;
      }[]
    | null;
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
   * Kept apart rather than merged into one list: sending a commercial
   * participant to inspect a business is a different decision from sending an
   * officer. The server refuses the conflicted combinations regardless.
   */
  kind?: 'officer' | 'agent';
  /** Out of allocation right now — on leave inside its window, or stood down. */
  onLeave?: boolean;
  /** `available` | `on_leave` | `unavailable`, for the label beside the name. */
  availabilityStatus?: string;
  leaveTo?: string | null;
}

export const STATUS_TONE: Record<string, Tone> = {
  new: 'caution',
  open: 'caution',
  assigned: 'brand',
  allocated: 'brand',
  in_progress: 'brand',
  approved: 'positive',
  resolved: 'positive',
  closed: 'neutral',
  rejected: 'critical',
  issue: 'critical',
  escalated: 'critical',
  additional_review: 'caution',
  submitted: 'brand',
  admin_review: 'brand',
  resolution_submitted: 'brand',
  waiting_for_information: 'caution',
  reassigned: 'caution',
};

/**
 * The in-person portal, section by section.
 *
 * Each one is a question somebody actually has: what is waiting on me, what am
 * I part-way through, what have I handed on, what came back. Ordered the way
 * work moves rather than by status name.
 */
export const SECTIONS: { key: string; label: string; blurb: string; statuses: string[] }[] = [
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

/** Case status filters, in the order work moves. */
export const CASE_FILTERS: { key: CaseStatus; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'allocated', label: 'Allocated' },
  { key: 'in_progress', label: 'In progress' },
  // A submitted resolution waiting on an administrator gets its own filter so
  // it is not invisible between "in progress" and "resolved".
  { key: 'resolution_submitted', label: 'In review' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'closed', label: 'Closed' },
];

export const RECOMMENDATION_LABEL: Record<string, string> = {
  approve: 'approval',
  reject: 'rejection',
  revisit: 'another visit',
};

/**
 * What an officer can do to resolve a case, by what the case is about.
 *
 * A generic "Resolve" told an officer nothing about a payout dispute versus a
 * locked listing. A `settle` action proposes an outcome the administrator
 * approves before anything moves — `release`/`refund` are the ones that
 * actually move escrow, `no_action` records what was done and closes it.
 * `escalate` sends it for a physical visit. The `key` is stored so the
 * resolution reads as the thing it was.
 */
export type CaseAction =
  | {
      key: string;
      label: string;
      kind: 'settle';
      outcome: 'release' | 'refund' | 'no_action';
      primary?: boolean;
    }
  | { key: string; label: string; kind: 'escalate' };

export const CASE_ACTIONS: Record<string, CaseAction[]> = {
  booking: [
    {
      key: 'verify_booking',
      label: 'Verify booking',
      kind: 'settle',
      outcome: 'release',
      primary: true,
    },
    {
      key: 'update_booking_status',
      label: 'Update booking status',
      kind: 'settle',
      outcome: 'no_action',
    },
    { key: 'confirm_cancellation', label: 'Confirm cancellation', kind: 'settle', outcome: 'refund' },
    { key: 'escalate', label: 'Escalate', kind: 'escalate' },
  ],
  payment: [
    {
      key: 'verify_payment',
      label: 'Verify payment',
      kind: 'settle',
      outcome: 'no_action',
      primary: true,
    },
    { key: 'verify_escrow', label: 'Verify escrow', kind: 'settle', outcome: 'no_action' },
    {
      key: 'recommend_release',
      label: 'Recommend escrow release',
      kind: 'settle',
      outcome: 'release',
    },
    { key: 'recommend_refund', label: 'Recommend refund', kind: 'settle', outcome: 'refund' },
    { key: 'escalate', label: 'Escalate', kind: 'escalate' },
  ],
  vendor: [
    {
      key: 'unlock_listing',
      label: 'Unlock business details',
      kind: 'settle',
      outcome: 'no_action',
      primary: true,
    },
    { key: 'request_correction', label: 'Request correction', kind: 'settle', outcome: 'no_action' },
    {
      key: 'review_changes',
      label: 'Approve or reject changes',
      kind: 'settle',
      outcome: 'no_action',
    },
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
  other: [
    { key: 'resolve', label: 'Resolve', kind: 'settle', outcome: 'no_action', primary: true },
    { key: 'escalate', label: 'Escalate', kind: 'escalate' },
  ],
};
