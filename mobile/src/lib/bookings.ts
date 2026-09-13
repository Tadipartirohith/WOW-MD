import type { Tone } from '@/components/chrome';

/**
 * The provider's incoming work, and the rules for reading it.
 *
 * All of this is lifted from the web client's BookingConsole and
 * ProviderBookings, which keep it in component files. The tabs, the labels and
 * the "next action" wording are the parts a vendor learns by using the product,
 * so they are kept word for word.
 */

export interface IncomingBooking {
  id: string;
  status: string;
  amount: string;
  currency: string;
  eventDate: string | null;
  createdAt: string;
  /**
   * The published window this was booked into, when there was one.
   *
   * Null means the customer named a date the provider had not opened — a
   * "request on date" rather than a booking against a slot. The distinction is
   * not a status, it is how the request arrived, which is why it is read from
   * here rather than from `status`.
   */
  slotId?: string | null;
  requirements: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  clientCity?: string | null;
  clientPhoto?: string | null;
  /** A note the customer added to the request, distinct from requirements. */
  notes?: string | null;
  eventName: string | null;
  eventVenue: string | null;
  eventCity: string | null;
  expectedGuests: number | null;
  serviceName: string | null;
  /** The package the customer picked, if any. */
  offeringName?: string | null;
  /** What the customer said they had in mind, before any quote. */
  expectedBudget?: string | null;
  paymentStatus: string | null;
  /** What the customer has actually paid so far, summed by the server. */
  paidAmount?: string | null;
  cancellationReason?: string | null;
  cancelledByName?: string | null;
  cancelledByRole?: string | null;
  vendorServiceId?: string | null;
  serviceAnswers?: Record<string, unknown>;
  quantity?: number | null;
}

/**
 * Actions the seller side may take, by current status.
 *
 * A request carries no price: the provider quotes first, which is why
 * `requested` offers a quotation rather than an acceptance.
 */
export const ACTIONS: Record<string, { label: string; path: string; primary?: boolean }[]> = {
  requested: [{ label: 'Decline', path: 'cancel' }],
  quotation_sent: [{ label: 'Withdraw', path: 'cancel' }],
  quotation_accepted: [
    { label: 'Accept the job', path: 'confirm', primary: true },
    { label: 'Decline', path: 'cancel' },
  ],
  payment_pending: [{ label: 'Cancel', path: 'cancel' }],
  // Historic: nothing enters `pending` any more, and the server moves it only to
  // confirmed or cancelled, which "Accept the job" never produced.
  pending: [{ label: 'Cancel', path: 'cancel' }],
  // From confirmed the server allows starting or cancelling; delivery comes
  // after the work has started, so "Mark delivered" here always failed.
  confirmed: [
    { label: 'Start work', path: 'start', primary: true },
    { label: 'Cancel', path: 'cancel' },
  ],
  in_progress: [{ label: 'Mark delivered', path: 'complete', primary: true }],
  completed: [],
  disputed: [],
  cancelled: [],
};

/** A provider can quote while the job is still unpriced or being re-priced. */
export const QUOTABLE = ['requested', 'quotation_sent'];

/**
 * The same statuses, said from the seller's side of the table.
 *
 * The shared labels are written for the buyer — "Request sent", "Quotation
 * received" — and a vendor reading their own queue was being told what they had
 * been sent by themselves. The status is the same status the customer sees; it
 * is the sentence that differs (EZ1-I259).
 */
export const SELLER_STATUS_LABEL: Record<string, string> = {
  requested: 'New request',
  quotation_sent: 'Quotation sent',
  quotation_accepted: 'Accepted by the customer',
  payment_pending: 'Awaiting the advance',
  pending: 'Paid, awaiting your confirmation',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  completed_pending_final_payment: 'Delivered — awaiting the final payment',
  completed: 'Completed',
  disputed: 'Under investigation',
  cancelled: 'Cancelled',
};

/**
 * The one thing this booking is waiting on the provider to do, by status.
 * Empty when the ball is in the customer's court or the job is done.
 */
export const NEXT_ACTION: Record<string, string> = {
  requested: 'Send a quotation',
  quotation_accepted: 'Accept the job',
  payment_pending: 'Awaiting the advance',
  confirmed: 'Start the work',
  in_progress: 'Mark delivered when done',
  completed_pending_final_payment: 'Awaiting the final payment',
};

/** The tabs, and which statuses each gathers. */
export const BOOKING_TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'all', label: 'All', statuses: [] },
  {
    key: 'requests',
    label: 'Requests',
    statuses: ['requested', 'quotation_sent', 'quotation_accepted'],
  },
  // Derived rather than status-based; `statuses` stays empty and the filter
  // special-cases it.
  { key: 'request_on_date', label: 'Request on Date', statuses: [] },
  { key: 'confirmed', label: 'Confirmed', statuses: ['payment_pending', 'pending', 'confirmed'] },
  // Delivered and awaiting the customer's confirmation is still work in hand:
  // the balance is unpaid and the job can still be disputed.
  {
    key: 'in_progress',
    label: 'In progress',
    statuses: ['in_progress', 'completed_pending_final_payment'],
  },
  { key: 'completed', label: 'Completed', statuses: ['completed'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled', 'disputed'] },
];

/**
 * The tab that gathers a status.
 *
 * A figure on the dashboard opens the bucket it counts, so the count and the
 * list behind it cannot disagree about which bucket that is. Anything the tabs
 * do not name falls back to All rather than to an empty screen.
 */
export function tabForStatus(status: string): string {
  return BOOKING_TABS.find((tab) => tab.statuses.includes(status))?.key ?? 'all';
}

export const PAYMENT_LABEL: Record<string, string> = {
  initiated: 'Payment started',
  held_in_escrow: 'Held in escrow',
  disputed: 'Disputed',
  pending_payout: 'Owed to you',
  released: 'Paid out',
  refunded: 'Refunded',
};

export const PAYMENT_TONE: Record<string, Tone> = {
  initiated: 'neutral',
  held_in_escrow: 'brand',
  disputed: 'critical',
  pending_payout: 'caution',
  released: 'positive',
  refunded: 'critical',
};

/**
 * Whether this arrived as a request against a date the provider never opened.
 *
 * The customer wanted a day with no published window and asked anyway, which
 * the provider has to answer differently: they are being asked whether they
 * *can* do it at all, not merely for a price against a slot they already
 * offered. Still an ordinary booking underneath, so it is derived here rather
 * than given a status of its own.
 */
export function isRequestOnDate(booking: IncomingBooking): boolean {
  return (
    !booking.slotId &&
    Boolean(booking.eventDate) &&
    ['requested', 'quotation_sent', 'quotation_accepted'].includes(booking.status)
  );
}

/** Where a job goes, said once rather than implied by six section headings. */
export const LIFECYCLE = [
  'Request',
  'Quotation',
  'Accepted',
  'Paid',
  'Confirmed',
  'In progress',
  // Delivered is its own step, not a synonym for completed: the vendor has
  // handed the work over and the customer has still to confirm it and pay the
  // balance. Leaving it out is what made "Awaiting the final payment" look
  // like a variety of Completed.
  'Delivered',
  'Completed',
];
