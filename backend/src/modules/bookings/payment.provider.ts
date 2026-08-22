import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { AppConfigService } from '../../config/app-config.service';

export interface PaymentIntent {
  providerRef: string;
  clientSecret?: string;
}

/** Normalised view of a gateway webhook, whatever the provider calls it. */
export interface WebhookEvent {
  /** Provider's own event id, used to drop replays. */
  eventId: string;
  type: string;
  providerRef: string | null;
  status: string;
}

/**
 * Pluggable payment gateway. The active provider is chosen by config
 * (PAYMENT_PROVIDER). 'mock' simulates escrow deterministically for local/tests;
 * 'razorpay' creates a real order via the Razorpay API. Both implement the same
 * interface, so no calling code changes when you switch.
 *
 * `release` takes the payout amount rather than the gross: the platform's
 * commission is withheld, so the seller receives less than was held in escrow.
 * It also takes where the money is going — a gateway that actually moves money
 * needs a destination, and inferring one inside the provider would put the
 * question of *who gets paid* somewhere nobody thinks to look.
 */
/**
 * Where a payout is going.
 *
 * `accountId` is the seller's linked account on the gateway — a Razorpay Route
 * `acc_...`. Null means the seller has not been onboarded yet, which is a
 * normal state (they can take bookings before their KYC clears) and not an
 * error: the release is recorded as pending rather than attempted, so the money
 * stays in escrow with a reason attached instead of vanishing into a failed
 * transfer.
 */
export interface PayoutDestination {
  accountId: string | null;
  /** Who this is, for the transfer's own notes. */
  label: string;
}

export interface PayoutResult {
  /** Whether money actually moved. */
  transferred: boolean;
  /** The gateway's reference for the transfer, when one happened. */
  transferRef: string | null;
  /** Why not, when it did not. Surfaced to the operator, never swallowed. */
  reason: string | null;
}

export interface PaymentProvider {
  createEscrowHold(amount: string, currency: string): Promise<PaymentIntent>;
  release(
    providerRef: string,
    payoutAmount: string,
    currency: string,
    destination: PayoutDestination,
  ): Promise<PayoutResult>;
  refund(providerRef: string, amount: string): Promise<void>;
  /**
   * Verifies the signature on an inbound webhook and normalises it. Returning
   * null means the signature did not check out and the request must be refused.
   */
  verifyWebhook(rawBody: string, signature: string | undefined): WebhookEvent | null;
}

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(MockPaymentProvider.name);

  async createEscrowHold(): Promise<PaymentIntent> {
    return { providerRef: `mock_${randomUUID()}`, clientSecret: 'mock_secret' };
  }

  async release(
    providerRef: string,
    payoutAmount: string,
    _currency: string,
    destination: PayoutDestination,
  ): Promise<PayoutResult> {
    // The mock mirrors the real rule rather than always succeeding: a seller
    // with no linked account cannot be paid by a live gateway either, and a
    // mock that pretends otherwise hides the case in every test that uses it.
    if (!destination.accountId) {
      return {
        transferred: false,
        transferRef: null,
        reason: 'The provider has no payout account yet.',
      };
    }
    this.logger.debug(`[mock] release ${payoutAmount} for ${providerRef}`);
    return { transferred: true, transferRef: `mock_txn_${randomUUID()}`, reason: null };
  }

  async refund(providerRef: string, amount: string): Promise<void> {
    this.logger.debug(`[mock] refund ${amount} for ${providerRef}`);
  }

  /**
   * The mock signs with the same HMAC scheme as the real provider so the
   * webhook route can be exercised end to end without a gateway account.
   */
  verifyWebhook(rawBody: string, signature: string | undefined): WebhookEvent | null {
    if (!signature) return null;
    const expected = createHmac('sha256', 'mock_webhook_secret').update(rawBody).digest('hex');
    if (!safeCompare(expected, signature)) return null;
    try {
      const parsed = JSON.parse(rawBody) as {
        id?: string;
        event?: string;
        providerRef?: string;
        status?: string;
      };
      return {
        eventId: parsed.id ?? randomUUID(),
        type: parsed.event ?? 'unknown',
        providerRef: parsed.providerRef ?? null,
        status: parsed.status ?? 'unknown',
      };
    } catch {
      return null;
    }
  }
}

/**
 * Real Razorpay provider using the REST API (native fetch, no SDK dependency).
 * createEscrowHold creates an order; the client completes payment against it.
 * Full hold-and-release escrow requires Razorpay Route transfers; `release`
 * is the single place to extend for that.
 */
@Injectable()
export class RazorpayPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(RazorpayPaymentProvider.name);

  constructor(private readonly cfg: AppConfigService) {}

  private authHeader(): string {
    const { razorpayKeyId, razorpayKeySecret } = this.cfg.payments;
    return 'Basic ' + Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64');
  }

  private toMinorUnits(amount: string): number {
    return Math.round(parseFloat(amount) * 100);
  }

  async createEscrowHold(amount: string, currency: string): Promise<PaymentIntent> {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: this.authHeader() },
      body: JSON.stringify({
        amount: this.toMinorUnits(amount),
        currency,
        receipt: `wow_${randomUUID()}`,
      }),
    });
    if (!res.ok) throw new Error(`Razorpay order failed: ${res.status} ${await res.text()}`);
    const order = (await res.json()) as { id: string };
    return { providerRef: order.id, clientSecret: this.cfg.payments.razorpayKeyId };
  }

  /**
   * Moves the seller's share out of escrow, through Razorpay Route.
   *
   * Route transfers are created against the *payment*, not the order, so the
   * captured payment id is resolved first. Transferring exactly the payout
   * amount is what leaves the commission on the platform account — there is no
   * separate commission transfer, and adding one would be a second way for the
   * split to be wrong.
   *
   * A seller with no linked account is reported rather than thrown: they can
   * take bookings before their KYC clears, and the money should stay in escrow
   * with a reason attached rather than failing a request the buyer already
   * completed.
   */
  async release(
    providerRef: string,
    payoutAmount: string,
    currency: string,
    destination: PayoutDestination,
  ): Promise<PayoutResult> {
    if (!destination.accountId) {
      return {
        transferred: false,
        transferRef: null,
        reason: 'The provider has not completed payout onboarding.',
      };
    }

    const paymentId = await this.capturedPaymentFor(providerRef);
    if (!paymentId) {
      return {
        transferred: false,
        transferRef: null,
        reason: `No captured payment found against ${providerRef}.`,
      };
    }

    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/transfers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: this.authHeader() },
      body: JSON.stringify({
        transfers: [
          {
            account: destination.accountId,
            amount: this.toMinorUnits(payoutAmount),
            currency,
            notes: { booking: providerRef, provider: destination.label },
            // The platform has already taken its commission by transferring
            // less than it holds, so nothing further is withheld here.
            on_hold: false,
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      // Not thrown: the booking is complete and the buyer has paid. An
      // exception here would roll back a completion that genuinely happened.
      this.logger.error(`Route transfer failed for ${providerRef}: ${res.status} ${body}`);
      return { transferred: false, transferRef: null, reason: `Gateway refused: ${res.status}` };
    }

    const parsed = (await res.json()) as { items?: { id?: string }[] };
    return {
      transferred: true,
      transferRef: parsed.items?.[0]?.id ?? null,
      reason: null,
    };
  }

  /**
   * The captured payment behind an order.
   *
   * An order can carry several attempts — a failed card, then a successful UPI
   * — and only the captured one can be transferred from.
   */
  private async capturedPaymentFor(orderId: string): Promise<string | null> {
    const res = await fetch(`https://api.razorpay.com/v1/orders/${orderId}/payments`, {
      headers: { authorization: this.authHeader() },
    });
    if (!res.ok) return null;
    const parsed = (await res.json()) as { items?: { id: string; status: string }[] };
    return parsed.items?.find((p) => p.status === 'captured')?.id ?? null;
  }

  /**
   * Returns the buyer's money.
   *
   * The full amount, always: the platform earns no commission on a booking that
   * did not happen. Refunding an order means refunding the payment that
   * captured against it.
   */
  async refund(providerRef: string, amount: string): Promise<void> {
    const paymentId = await this.capturedPaymentFor(providerRef);
    if (!paymentId) {
      this.logger.error(`Refund for ${providerRef} found no captured payment`);
      return;
    }

    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: this.authHeader() },
      body: JSON.stringify({
        amount: this.toMinorUnits(amount),
        // Razorpay dedupes on this, so a retried cancellation refunds once.
        speed: 'normal',
        notes: { order: providerRef },
      }),
    });
    if (!res.ok) {
      this.logger.error(`Refund failed for ${providerRef}: ${res.status} ${await res.text()}`);
    }
  }

  /**
   * Razorpay signs the raw request body with the webhook secret. Comparing the
   * HMAC is what makes a webhook trustworthy — without it anyone who knows a
   * payment reference could post a "payment captured" event.
   */
  verifyWebhook(rawBody: string, signature: string | undefined): WebhookEvent | null {
    const secret = this.cfg.payments.webhookSecret;
    if (!secret || !signature) return null;

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!safeCompare(expected, signature)) return null;

    try {
      const parsed = JSON.parse(rawBody) as {
        id?: string;
        event?: string;
        payload?: { payment?: { entity?: { order_id?: string; status?: string } } };
      };
      const entity = parsed.payload?.payment?.entity;
      return {
        eventId: parsed.id ?? randomUUID(),
        type: parsed.event ?? 'unknown',
        providerRef: entity?.order_id ?? null,
        status: entity?.status ?? 'unknown',
      };
    } catch {
      return null;
    }
  }
}

/** Length-safe constant-time hex comparison. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

export const paymentProviderFactory = {
  provide: PAYMENT_PROVIDER,
  inject: [AppConfigService, MockPaymentProvider, RazorpayPaymentProvider],
  useFactory: (
    cfg: AppConfigService,
    mock: MockPaymentProvider,
    razorpay: RazorpayPaymentProvider,
  ): PaymentProvider => (cfg.payments.provider === 'razorpay' ? razorpay : mock),
};
