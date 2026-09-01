import { formatDate } from './dates';

/**
 * How a notification is worded.
 *
 * Lifted out of the notifications page so the mobile app renders the same
 * sentences. This is the most-repeated user-facing copy in the product, and
 * two apps describing the same event differently is the kind of small
 * wrongness nobody reports and everybody notices. Pure: it takes a row and
 * returns a string, and knows nothing about how either app draws it.
 */

export interface Notification {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  /** Where the server says this goes. Null on rows written before it said. */
  targetModule: string | null;
  targetAction: string | null;
  targetId: string | null;
  isRead: boolean;
  createdAt: string;
}

/** What the reader is being asked to do, when it is more than "look". */
export const ACTION_LABEL: Record<string, string> = {
  respond: 'Respond',
  pay: 'Pay',
  review: 'Review',
  reply: 'Reply',
};

export const TYPE_LABEL: Record<string, string> = {
  match_interest: 'Interest shown',
  match_accepted: 'Interest accepted',
  new_message: 'New message',
  match_conversation: 'Your clients are talking',
  task_reminder: 'Reminder',
  booking_update: 'Booking update',

  booking_request: 'New request',
  booking_quotation: 'Quotation',
  booking_confirmed: 'Job accepted',
  booking_payment: 'Payment held',
  booking_started: 'Work started',
  booking_completed: 'Work delivered',
  booking_cancelled: 'Booking cancelled',

  verification_assigned: 'Visit assigned to you',
  verification_submitted: 'Findings submitted',
  verification_requested: 'New application',
  verification_decided: 'Verification decided',
  dispute_update: 'Dispute',
};

/** A sentence a person can read, built from whatever the payload carries. */
export function describe(n: Notification): string {
  const p = n.payload ?? {};
  const str = (key: string) => (typeof p[key] === 'string' ? String(p[key]) : null);
  const status = str('status')?.replace(/_/g, ' ') ?? '';
  const client = str('clientName') ?? 'A client';
  const service = str('service');
  const when = p.eventDate ? formatDate(String(p.eventDate)) : null;
  const money = str('amount') ? `${str('currency') ?? 'INR'} ${str('amount')}` : null;

  // What the reader needs to decide whether to open it: who, what, and when.
  const job = [service, when].filter(Boolean).join(' · ');

  switch (n.type) {
    case 'booking_request':
      return `${client} has asked about ${job || 'your services'}.`;
    case 'booking_quotation':
      return money ? `${money}: ${job || 'the job'}.` : `A quotation on ${job || 'the job'}.`;
    case 'booking_confirmed':
      return `The provider has accepted ${job || 'the job'}. The date is held.`;
    case 'booking_payment':
      return money ? `${money} is in escrow for ${job || 'the job'}.` : 'A payment is in escrow.';
    case 'booking_started':
      return `Work has started on ${job || 'the job'}.`;
    case 'booking_completed':
      return `${job || 'The job'} is delivered. The balance is now payable.`;
    case 'booking_cancelled':
      return `${job || 'A booking'} was cancelled.`;
    case 'verification_assigned':
      return `A ${str('applicantType') ?? 'business'} verification is on your queue.`;
    case 'verification_requested':
      return `A ${str('applicantType') ?? 'business'} has applied and is waiting to be allocated.`;
    case 'verification_submitted':
      return `An officer recommends ${str('recommendation') ?? 'a decision'}${
        typeof p.issues === 'number' && p.issues > 0 ? `, with ${p.issues} issue(s)` : ''
      }.`;
    case 'verification_decided':
      return status ? `Your verification was ${status}.` : 'Your verification was decided.';
    case 'booking_update':
      return status ? `A booking moved to ${status}.` : 'One of your bookings changed.';
    case 'new_message':
      return str('preview') ?? 'Someone replied to you.';
    case 'match_interest':
      return str('counterpartName')
        ? `${str('counterpartName')}${str('counterpartCity') ? ` from ${str('counterpartCity')}` : ''} would like to take your profile forward.`
        : 'Someone would like to take your profile forward.';
    case 'match_accepted':
      // Naming them is the whole point: somebody who has sent five interests
      // cannot act on "your interest was accepted".
      return str('counterpartName')
        ? `${str('counterpartName')} accepted your interest.`
        : 'Your interest was accepted.';
    case 'match_conversation': {
      const who = str('coupleNames') ?? 'Two of your clients';
      return str('kind') === 'call'
        ? `${who} have started a call.`
        : `${who} have started a conversation.`;
    }
    case 'task_reminder':
      return str('title') ?? 'A planning task is due.';
    default:
      return '';
  }
}

/**
 * How often the badge and the feed ask.
 *
 * Twenty seconds, not the sixty this started at. The original argument —
 * nobody is worse off for a count being a minute stale — holds for a badge
 * nobody is watching and breaks the moment somebody is waiting on an answer: a
 * vendor who has just submitted for verification, a couple who have just sent
 * an interest. A minute of nothing reads as nothing happened.
 *
 * Lives here rather than in App so the feed can share it without importing the
 * router, which imports the feed.
 */
export const UNREAD_POLL_MS = 20_000;
