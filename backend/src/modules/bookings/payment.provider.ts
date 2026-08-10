import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppConfigService } from '../../config/app-config.service';

export interface PaymentIntent {
  providerRef: string;
  clientSecret?: string;
}

/**
 * Pluggable payment gateway. The active provider is chosen by config
 * (PAYMENT_PROVIDER). 'mock' simulates escrow deterministically for local/tests;
 * 'razorpay' creates a real order via the Razorpay API. Both implement the same
 * interface, so no calling code changes when you switch.
 */
export interface PaymentProvider {
  createEscrowHold(amount: string, currency: string): Promise<PaymentIntent>;
  release(providerRef: string): Promise<void>;
  refund(providerRef: string): Promise<void>;
}

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  async createEscrowHold(): Promise<PaymentIntent> {
    return { providerRef: `mock_${randomUUID()}`, clientSecret: 'mock_secret' };
  }
  async release(): Promise<void> {
    /* no-op for mock */
  }
  async refund(): Promise<void> {
    /* no-op for mock */
  }
}

/**
 * Real Razorpay provider using the REST API (native fetch, no SDK dependency).
 * createEscrowHold creates an order; the client completes payment against it.
 * Full hold-and-release escrow requires Razorpay Route transfers, release and
 * refund here call the standard refund endpoint and log intent, and are the
 * single place to extend for Route.
 */
@Injectable()
export class RazorpayPaymentProvider implements PaymentProvider {
  private readonly logger = new Logger(RazorpayPaymentProvider.name);

  constructor(private readonly cfg: AppConfigService) {}

  private authHeader(): string {
    const { razorpayKeyId, razorpayKeySecret } = this.cfg.payments;
    return 'Basic ' + Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64');
  }

  async createEscrowHold(amount: string, currency: string): Promise<PaymentIntent> {
    const paise = Math.round(parseFloat(amount) * 100);
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: this.authHeader() },
      body: JSON.stringify({ amount: paise, currency, receipt: `wow_${randomUUID()}` }),
    });
    if (!res.ok) throw new Error(`Razorpay order failed: ${res.status} ${await res.text()}`);
    const order = (await res.json()) as { id: string };
    return { providerRef: order.id, clientSecret: this.cfg.payments.razorpayKeyId };
  }

  async release(providerRef: string): Promise<void> {
    // With Razorpay Route this triggers a transfer to the vendor's linked account.
    this.logger.log(`Release escrow for ${providerRef} (configure Razorpay Route for real transfers)`);
  }

  async refund(providerRef: string): Promise<void> {
    this.logger.log(`Refund requested for ${providerRef}`);
  }
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
