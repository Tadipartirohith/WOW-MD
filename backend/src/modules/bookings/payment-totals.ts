import { PaymentStatus } from '../../common/enums';

/** The part of a payment row these sums care about. */
export interface CountedPayment {
  bookingId: string;
  amount: string;
  status: PaymentStatus;
}

/**
 * A payment in one of these states is not money in hand.
 *
 * A failed charge never arrived and a refunded one has gone back. Both leave
 * their row on the booking — the history matters — and neither may be counted
 * as paid, or a refunded advance would go on reading as an advance held.
 */
const NOT_COLLECTED: PaymentStatus[] = [PaymentStatus.FAILED, PaymentStatus.REFUNDED];

export function isCollected(status: PaymentStatus): boolean {
  return !NOT_COLLECTED.includes(status);
}

/**
 * What has actually been collected against each booking, keyed by booking id.
 *
 * Used to put "paid so far" on a provider's queue without asking the instalment
 * endpoint once per row (EZ1-I259). Kept out of the listing method and pure, so
 * the rule about what counts as paid is stated in one place and can be tested
 * without a database.
 */
export function collectedByBooking(payments: CountedPayment[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const payment of payments) {
    if (!isCollected(payment.status)) continue;
    totals.set(
      payment.bookingId,
      (totals.get(payment.bookingId) ?? 0) + Number(payment.amount || 0),
    );
  }
  return totals;
}
