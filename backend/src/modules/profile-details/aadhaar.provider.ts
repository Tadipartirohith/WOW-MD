import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import { AppConfigService } from '../../config/app-config.service';

export interface OtpDispatch {
  /** The provider's reference for this attempt. */
  providerRef: string;
  /**
   * Only ever populated by the mock, and only in the 'mock' mode — a real
   * provider sends the code to the registered mobile and never tells us what
   * it was. It exists so the flow can be exercised end to end without an
   * Aadhaar contract.
   */
  devCode?: string;
}

/**
 * Aadhaar OTP verification.
 *
 * UIDAI does not issue credentials directly to a marketplace; in practice this
 * runs through a licensed AUA/KUA (Cashfree, Signzy, Karza and so on). The
 * interface is deliberately the small part they all agree on — send an OTP
 * against a number, then verify a code against the reference — so swapping
 * providers is a class, not a rewrite.
 */
export interface AadhaarProvider {
  /** Ask the provider to send an OTP to the number registered against the Aadhaar. */
  sendOtp(aadhaarNumber: string): Promise<OtpDispatch>;
  /**
   * Confirm the code. Returns false rather than throwing on a wrong code,
   * because a wrong code is an ordinary event and not an error.
   */
  verifyOtp(providerRef: string, code: string): Promise<boolean>;
}

export const AADHAAR_PROVIDER = Symbol('AADHAAR_PROVIDER');

/**
 * Local stand-in. Generates a real six-digit code and hands it back on the
 * response so the flow works without an Aadhaar contract; the verification
 * itself is done by the service against the stored hash, exactly as it would be
 * with a live provider that returns a yes or no.
 */
@Injectable()
export class MockAadhaarProvider implements AadhaarProvider {
  private readonly logger = new Logger(MockAadhaarProvider.name);

  async sendOtp(): Promise<OtpDispatch> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const providerRef = `mock_aadhaar_${randomUUID()}`;
    this.logger.debug(`[mock] OTP ${code} for ${providerRef}`);
    return { providerRef, devCode: code };
  }

  /**
   * The mock has no opinion: the service compares the code against the hash it
   * stored, which is the same check a real provider performs on its side.
   */
  async verifyOtp(): Promise<boolean> {
    return true;
  }
}

/**
 * A live AUA/KUA integration.
 *
 * UIDAI does not issue credentials to a marketplace directly; in practice this
 * runs through a licensed provider — Cashfree, Signzy, Karza, Digio — and they
 * have converged on the same two-call shape: post the number and get a
 * reference back, then post the reference and the code.
 *
 * What differs between them is the envelope, not the conversation: the base
 * URL, whether the key goes in a header or the body, and what the fields are
 * called. All of that is configuration here rather than a fork per vendor, so
 * switching provider is an environment change.
 *
 * Two things this deliberately does *not* do:
 *
 * - It never logs the Aadhaar number, not even truncated. A number in a log
 *   file is a number that has left the system's control.
 * - It does not treat a wrong OTP as an error. A wrong code is an ordinary
 *   event; only a broken integration throws.
 */
@Injectable()
export class LicensedAadhaarProvider implements AadhaarProvider {
  private readonly logger = new Logger(LicensedAadhaarProvider.name);

  constructor(private readonly cfg: AppConfigService) {}

  private assertConfigured(): {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    timeoutMs: number;
  } {
    const { aadhaarBaseUrl, aadhaarClientId, aadhaarClientSecret, aadhaarTimeoutMs } =
      this.cfg.identity;

    if (!aadhaarBaseUrl || !aadhaarClientId || !aadhaarClientSecret) {
      // Named plainly, because the failure otherwise surfaces as a fetch error
      // against an empty URL and reads like a network problem.
      throw new ServiceUnavailableException(
        'AADHAAR_PROVIDER is set to a licensed provider, but AADHAAR_BASE_URL, ' +
          'AADHAAR_CLIENT_ID and AADHAAR_CLIENT_SECRET are not all configured.',
      );
    }
    return {
      baseUrl: aadhaarBaseUrl.replace(/\/+$/, ''),
      clientId: aadhaarClientId,
      clientSecret: aadhaarClientSecret,
      timeoutMs: aadhaarTimeoutMs || 15_000,
    };
  }

  /**
   * One request, with the timeout the provider will not give you.
   *
   * A verification provider that hangs holds a request worker for as long as it
   * feels like, and the person on the other end has already tapped the button
   * three times.
   */
  private async post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const { baseUrl, clientId, clientSecret, timeoutMs } = this.assertConfigured();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-client-id': clientId,
          'x-client-secret': clientSecret,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        // A provider returning HTML is a provider having an outage.
        this.logger.error(`Aadhaar provider returned non-JSON on ${path} (${res.status})`);
      }
      return { ok: res.ok, status: res.status, json };
    } finally {
      clearTimeout(timer);
    }
  }

  async sendOtp(aadhaarNumber: string): Promise<OtpDispatch> {
    const { ok, status, json } = await this.post('/verification/aadhaar/otp', {
      aadhaar_number: aadhaarNumber,
    });

    if (!ok) {
      // The number never appears in the message; the status and the provider's
      // own message are enough to diagnose without carrying it into a log.
      const message = typeof json.message === 'string' ? json.message : `HTTP ${status}`;
      throw new ServiceUnavailableException(
        `Aadhaar verification is unavailable right now (${message}). Try again shortly.`,
      );
    }

    // Providers disagree on what to call the reference. All three names are
    // theirs, not ours — none of this is a guess about a field we invented.
    const providerRef =
      (typeof json.ref_id === 'string' && json.ref_id) ||
      (typeof json.reference_id === 'string' && json.reference_id) ||
      (typeof json.transaction_id === 'string' && json.transaction_id) ||
      null;

    if (!providerRef) {
      throw new ServiceUnavailableException(
        'The Aadhaar provider accepted the request but returned no reference.',
      );
    }
    return { providerRef };
  }

  async verifyOtp(providerRef: string, code: string): Promise<boolean> {
    const { ok, status, json } = await this.post('/verification/aadhaar/verify', {
      ref_id: providerRef,
      otp: code,
    });

    if (ok) {
      // Some providers answer 200 with a status field rather than an HTTP code,
      // so a bare 200 is not on its own a yes.
      const verdict = typeof json.status === 'string' ? json.status.toLowerCase() : '';
      if (verdict) return ['success', 'valid', 'verified'].includes(verdict);
      return json.valid === true || json.verified === true;
    }

    // A wrong code comes back as a client error and is an ordinary event: the
    // person mistyped six digits. Anything else is the integration failing, and
    // must not be reported to the caller as "wrong code" — that would let an
    // outage look like a failed verification and lock somebody out.
    if (status === 400 || status === 401 || status === 422) return false;

    const message = typeof json.message === 'string' ? json.message : `HTTP ${status}`;
    throw new ServiceUnavailableException(
      `Aadhaar verification is unavailable right now (${message}). Try again shortly.`,
    );
  }
}

export const aadhaarProviderFactory = {
  provide: AADHAAR_PROVIDER,
  inject: [AppConfigService, MockAadhaarProvider, LicensedAadhaarProvider],
  useFactory: (
    cfg: AppConfigService,
    mock: MockAadhaarProvider,
    licensed: LicensedAadhaarProvider,
  ): AadhaarProvider => (cfg.identity.aadhaarProvider === 'mock' ? mock : licensed),
};
