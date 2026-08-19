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
 */
export interface PaymentProvider {
  createEscrowHold(amount: string, currency: string): Promise<PaymentIntent>;
  release(providerRef: string, payoutAmount: string, currency: string): Promise<void>;
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

  async release(providerRef: string, payoutAmount: string): Promise<void> {
    this.logger.debug(`[mock] release ${payoutAmount} for ${providerRef}`);
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

  async release(providerRef: string, payoutAmount: string, currency: string): Promise<void> {
    // With Razorpay Route this creates a transfer of exactly the payout amount
    // to the seller's linked account, leaving the commission on the platform.
    this.logger.log(
      `Release ${currency} ${payoutAmount} for ${providerRef} (configure Razorpay Route for real transfers)`,
    );
  }

  async refund(providerRef: string, amount: string): Promise<void> {
    this.logger.log(`Refund ${amount} requested for ${providerRef}`);
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
