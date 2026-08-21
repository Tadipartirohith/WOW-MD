import { Inject, Injectable, Logger } from '@nestjs/common';
import { SMS_PROVIDER, SmsProvider } from './sms.provider';
import { AppConfigService } from '../../config/app-config.service';

/**
 * The messages the platform sends by SMS.
 *
 * Kept short on purpose. These are read on a feature phone by somebody who did
 * not ask for the message, and every one of them has to answer "who is this and
 * what do I do" inside two lines. A 160-character segment is one billed unit;
 * spilling into a second to be polite doubles the cost of every invitation the
 * platform ever sends.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    @Inject(SMS_PROVIDER) private readonly provider: SmsProvider,
    private readonly cfg: AppConfigService,
  ) {}

  /**
   * Sends, and never throws.
   *
   * Every caller here is doing something that has already succeeded — an
   * invitation row exists, a code is stored. Letting a gateway outage roll that
   * back would be worse than the missing message, and all of these can be
   * resent.
   */
  private async send(to: string, body: string): Promise<boolean> {
    try {
      await this.provider.send({ to, body });
      return true;
    } catch (err) {
      this.logger.warn(`SMS to ${to} failed: ${(err as Error).message}`);
      return false;
    }
  }

  /** The invitation, alongside the email. Often the only channel that reaches. */
  async sendProfileInvitation(params: {
    to: string;
    inviteeName: string;
    stewardName: string;
    token: string;
  }): Promise<boolean> {
    const url = `${this.cfg.mail.appBaseUrl}/invite/${params.token}`;
    return this.send(
      params.to,
      `${params.stewardName} has set up your WOW matrimony profile. ` +
        `Set your password and take control of it: ${url}`,
    );
  }

  /** Confirms the number is real and reachable, which matters more than email here. */
  async sendPhoneVerification(params: { to: string; code: string }): Promise<boolean> {
    return this.send(
      params.to,
      `${params.code} is your WOW verification code. It expires in 10 minutes. ` +
        `Do not share it with anyone.`,
    );
  }

  /** The emailed temporary password is useless to somebody with no email address. */
  async sendProvisionedCredentials(params: {
    to: string;
    temporaryPassword: string;
  }): Promise<boolean> {
    return this.send(
      params.to,
      `Your WOW account is ready. Temporary password: ${params.temporaryPassword} ` +
        `— sign in at ${this.cfg.mail.appBaseUrl} and change it straight away.`,
    );
  }

  /** Chases an instalment nobody is chasing today. */
  async sendMilestoneReminder(params: {
    to: string;
    providerName: string;
    milestone: string;
    amount: string;
  }): Promise<boolean> {
    return this.send(
      params.to,
      `Your ${params.milestone} of Rs ${params.amount} for ${params.providerName} is due. ` +
        `Pay it at ${this.cfg.mail.appBaseUrl}/bookings`,
    );
  }
}
