import { PaymentStatus } from '../../common/enums';
import { collectedByBooking, isCollected } from './payment-totals';

const payment = (
  bookingId: string,
  amount: string,
  status: PaymentStatus = PaymentStatus.HELD_IN_ESCROW,
) => ({ bookingId, amount, status });

describe('collectedByBooking', () => {
  it('sums the instalments on each booking separately', () => {
    const totals = collectedByBooking([
      payment('b1', '30000.00'),
      payment('b1', '20000.00'),
      payment('b2', '5000.00'),
    ]);
    expect(totals.get('b1')).toBe(50000);
    expect(totals.get('b2')).toBe(5000);
  });

  // The whole point of the rule: a refunded advance is not an advance held, and
  // a failed charge never arrived.
  it('leaves out what was never collected', () => {
    const totals = collectedByBooking([
      payment('b1', '30000.00', PaymentStatus.RELEASED),
      payment('b1', '30000.00', PaymentStatus.REFUNDED),
      payment('b1', '10000.00', PaymentStatus.FAILED),
    ]);
    expect(totals.get('b1')).toBe(30000);
  });

  it('counts money still in escrow and money already paid out alike', () => {
    // Both are collected from the customer; where it sits afterwards is a
    // different question from whether they have paid.
    for (const status of [
      PaymentStatus.INITIATED,
      PaymentStatus.HELD_IN_ESCROW,
      PaymentStatus.DISPUTED,
      PaymentStatus.PENDING_PAYOUT,
      PaymentStatus.RELEASED,
    ]) {
      expect(isCollected(status)).toBe(true);
    }
    expect(isCollected(PaymentStatus.FAILED)).toBe(false);
    expect(isCollected(PaymentStatus.REFUNDED)).toBe(false);
  });

  it('has nothing to say about a booking with no payments', () => {
    expect(collectedByBooking([]).get('b1')).toBeUndefined();
  });
});
