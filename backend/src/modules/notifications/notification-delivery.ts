import { NotificationType } from '../../common/enums';

/**
 * How a notification reads on a phone, and whether it goes to WhatsApp at all.
 *
 * A push notification is one line on a lock screen. The in-app feed can afford
 * "A quotation of ₹85,000 arrived on your booking for 14 February"; the lock
 * screen gets the shortest sentence that makes somebody open the app, because
 * anything longer is truncated by the operating system mid-word.
 *
 * `whatsappTemplate` is null for most types on purpose. A business-initiated
 * WhatsApp message has to be one of a handful of templates the number has had
 * approved by Meta and, in India, registered under DLT. Every template is a
 * separate approval with its own turnaround, so the platform registers the few
 * that are worth interrupting somebody's WhatsApp for — money and jobs — and
 * leaves the rest to the app. A type with no template simply does not go out
 * that way, rather than being sent as free text the API would refuse.
 */
export interface DeliverySpec {
  /** The lock-screen title. Short enough to survive truncation. */
  title: string;
  /** Builds the one-line body from whatever the payload carries. */
  body: (payload: Record<string, unknown>) => string;
  /** The approved template name, or null if this type never goes to WhatsApp. */
  whatsappTemplate: string | null;
  /** Positional parameters for that template, in the order it declares them. */
  whatsappParams?: (payload: Record<string, unknown>) => string[];
}

const str = (payload: Record<string, unknown>, key: string, fallback = ''): string => {
  const value = payload[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
};

const money = (payload: Record<string, unknown>): string => {
  const amount = str(payload, 'amount');
  return amount ? `${str(payload, 'currency', 'INR')} ${amount}` : '';
};

const job = (payload: Record<string, unknown>): string => {
  const parts = [str(payload, 'service'), str(payload, 'eventDate')].filter(Boolean);
  return parts.join(' · ') || 'your booking';
};

export const DELIVERY: Record<NotificationType, DeliverySpec> = {
  [NotificationType.MATCH_INTEREST]: {
    title: 'Someone is interested',
    body: (p) => `${str(p, 'counterpartName', 'A family')} would like to take your profile forward.`,
    whatsappTemplate: null,
  },
  [NotificationType.MATCH_ACCEPTED]: {
    title: 'Your interest was accepted',
    body: (p) => `${str(p, 'counterpartName', 'They')} have accepted. You can talk now.`,
    whatsappTemplate: null,
  },
  [NotificationType.MATCH_CONVERSATION]: {
    title: 'Your clients have started talking',
    body: (p) =>
      `${str(p, 'coupleNames', 'Two of your clients')} have ${
        str(p, 'kind', 'message') === 'call' ? 'started a call' : 'started a conversation'
      }.`,
    whatsappTemplate: null,
  },
  [NotificationType.NEW_MESSAGE]: {
    title: 'New message',
    // The preview is deliberately not put on the lock screen. A matrimony
    // conversation read over somebody's shoulder is a real harm, and the
    // notification only has to be worth opening.
    body: () => 'Someone has replied to you.',
    whatsappTemplate: null,
  },
  [NotificationType.TASK_REMINDER]: {
    title: 'Wedding plan',
    body: (p) => str(p, 'title', 'Something on your plan is due.'),
    whatsappTemplate: null,
  },
  [NotificationType.BOOKING_UPDATE]: {
    title: 'Booking update',
    body: (p) => `A booking moved to ${str(p, 'status', 'a new stage').replace(/_/g, ' ')}.`,
    whatsappTemplate: null,
  },

  [NotificationType.BOOKING_REQUEST]: {
    title: 'New request',
    body: (p) => `${str(p, 'clientName', 'A client')} has asked about ${job(p)}.`,
    // Worth a WhatsApp: a vendor who misses an enquiry loses the job, and this
    // is the one notification where being interrupted is the point.
    whatsappTemplate: 'booking_request',
    whatsappParams: (p) => [str(p, 'clientName', 'A client'), job(p)],
  },
  [NotificationType.BOOKING_QUOTATION]: {
    title: 'Quotation received',
    body: (p) => `${money(p) || 'A price'} for ${job(p)}.`,
    whatsappTemplate: 'booking_quotation',
    whatsappParams: (p) => [money(p) || 'A price', job(p)],
  },
  [NotificationType.BOOKING_CONFIRMED]: {
    title: 'Job accepted',
    body: (p) => `Your provider has accepted ${job(p)}. The date is held.`,
    whatsappTemplate: null,
  },
  [NotificationType.BOOKING_PAYMENT]: {
    title: 'Payment held',
    body: (p) => `${money(p) || 'A payment'} is in escrow for ${job(p)}.`,
    whatsappTemplate: 'booking_payment',
    whatsappParams: (p) => [money(p) || 'A payment', job(p)],
  },
  [NotificationType.BOOKING_STARTED]: {
    title: 'Work started',
    body: (p) => `Work has started on ${job(p)}.`,
    whatsappTemplate: null,
  },
  [NotificationType.BOOKING_COMPLETED]: {
    title: 'Balance due',
    body: (p) => `${job(p)} is delivered. The balance is now payable.`,
    whatsappTemplate: 'booking_completed',
    whatsappParams: (p) => [job(p)],
  },
  [NotificationType.BOOKING_CANCELLED]: {
    title: 'Booking cancelled',
    body: (p) => `${job(p)} was cancelled.`,
    whatsappTemplate: null,
  },

  [NotificationType.VERIFICATION_ASSIGNED]: {
    title: 'A visit is on your queue',
    body: (p) => `A ${str(p, 'applicantType', 'business')} verification needs you.`,
    whatsappTemplate: null,
  },
  [NotificationType.VERIFICATION_DECIDED]: {
    title: 'Verification decided',
    body: (p) => `Your verification was ${str(p, 'status', 'decided').replace(/_/g, ' ')}.`,
    // A rejection or a request to fix something is worth reaching somebody for:
    // a listing sitting unfixed is a business not trading.
    whatsappTemplate: 'verification_decided',
    whatsappParams: (p) => [str(p, 'status', 'decided').replace(/_/g, ' ')],
  },
  [NotificationType.VERIFICATION_SUBMITTED]: {
    title: 'Findings to review',
    body: (p) => `An officer recommends ${str(p, 'recommendation', 'a decision')}.`,
    whatsappTemplate: null,
  },
  [NotificationType.VERIFICATION_REQUESTED]: {
    title: 'A business has applied',
    body: (p) => `A ${str(p, 'applicantType', 'business')} is waiting to be allocated.`,
    whatsappTemplate: null,
  },
  [NotificationType.DISPUTE_UPDATE]: {
    title: 'Dispute',
    body: () => 'There is an update on a dispute you are part of.',
    whatsappTemplate: null,
  },
};
