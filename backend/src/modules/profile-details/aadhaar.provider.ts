import { Injectable, Logger } from '@nestjs/common';
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
 * A live AUA/KUA integration goes here. It is deliberately left unimplemented
 * rather than half-written: the request signing, licence key handling and
 * consent-text requirements differ per provider and per contract, and a stub
 * that looks finished is worse than one that says it is not.
 */
@Injectable()
export class LicensedAadhaarProvider implements AadhaarProvider {
  private readonly logger = new Logger(LicensedAadhaarProvider.name);

  constructor(private readonly cfg: AppConfigService) {}

  async sendOtp(): Promise<OtpDispatch> {
    throw new Error(
      'AADHAAR_PROVIDER is set to a licensed provider, but no integration is configured. ' +
        'Supply the AUA/KUA credentials and implement the request signing for your contract.',
    );
  }

  async verifyOtp(): Promise<boolean> {
    throw new Error('No licensed Aadhaar provider is configured');
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
