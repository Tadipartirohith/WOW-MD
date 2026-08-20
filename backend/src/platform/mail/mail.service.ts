import { Inject, Injectable, Logger } from '@nestjs/common';
import { MAIL_PROVIDER, MailProvider } from './mail.provider';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Every transactional email the platform sends.
 *
 * Templates live here rather than in the calling services so the wording, the
 * link construction and the escaping are in one place. Sends never throw into
 * the caller: the underlying record (invitation, reset token) is already
 * committed and can be resent, so a flaky SMTP host must not fail the request
 * that triggered it.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @Inject(MAIL_PROVIDER) private readonly provider: MailProvider,
    private readonly cfg: AppConfigService,
  ) {}

  private link(path: string, token: string): string {
    const base = this.cfg.mail.appBaseUrl.replace(/\/+$/, '');
    return `${base}${path}/${encodeURIComponent(token)}`;
  }

  /** Minimal escaping for values interpolated into the HTML bodies below. */
  private esc(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private async send(to: string, subject: string, heading: string, body: string, cta?: { label: string; url: string }): Promise<void> {
    const textCta = cta ? `\n\n${cta.label}:\n${cta.url}\n` : '\n';
    const htmlCta = cta
      ? `<p style="margin:24px 0"><a href="${this.esc(cta.url)}" style="background:#be185d;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${this.esc(cta.label)}</a></p>
         <p style="color:#6b7280;font-size:12px">If the button does not work, paste this into your browser:<br>${this.esc(cta.url)}</p>`
      : '';

    try {
      await this.provider.send({
        to,
        subject,
        text: `${heading}\n\n${body}${textCta}\n— WOW, World of Weddings`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#111827">
                 <h1 style="color:#be185d;font-size:20px">${this.esc(heading)}</h1>
                 <p style="line-height:1.6">${this.esc(body).replace(/\n/g, '<br>')}</p>
                 ${htmlCta}
                 <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">
                 <p style="color:#6b7280;font-size:12px">WOW, World of Weddings</p>
               </div>`,
      });
    } catch {
      this.logger.warn(`Mail "${subject}" to ${to} could not be delivered; the action itself succeeded.`);
    }
  }

  /**
   * Invitation to claim a profile someone else built. This is the only route
   * from a steward-created profile to a real, self-owned account.
   */
  async sendProfileInvitation(params: {
    to: string;
    inviteeName: string;
    stewardName: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    const days = Math.max(1, Math.round((params.expiresAt.getTime() - Date.now()) / 86_400_000));
    await this.send(
      params.to,
      'You have been invited to WOW',
      `Hello ${params.inviteeName},`,
      `${params.stewardName} has prepared a marriage profile for you on WOW, World of Weddings.\n` +
        `Accept the invitation to verify your email, choose your own password and take ownership of the profile. ` +
        `Until you do, only ${params.stewardName} can act on it.\n\n` +
        `This invitation expires in ${days} day(s).`,
      { label: 'Accept invitation', url: this.link('/invite', params.token) },
    );
  }

  async sendEmailVerification(params: { to: string; name: string; token: string }): Promise<void> {
    await this.send(
      params.to,
      'Confirm your email address',
      `Hello ${params.name},`,
      'Confirm this address to finish setting up your WOW account. Some features stay locked until you do.',
      { label: 'Confirm email', url: this.link('/verify-email', params.token) },
    );
  }

  async sendPasswordReset(params: { to: string; name: string; token: string }): Promise<void> {
    await this.send(
      params.to,
      'Reset your password',
      `Hello ${params.name},`,
      'Someone asked to reset the password on this WOW account. If that was not you, ignore this email and nothing changes. ' +
        'The link below works once and expires shortly.',
      { label: 'Choose a new password', url: this.link('/reset-password', params.token) },
    );
  }

  async sendRsvpInvitation(params: {
    to: string;
    guestName: string;
    eventName: string;
    hostName: string;
    token: string;
  }): Promise<void> {
    await this.send(
      params.to,
      `You are invited to ${params.eventName}`,
      `Hello ${params.guestName},`,
      `${params.hostName} has invited you to ${params.eventName}. Let them know whether you can make it — ` +
        'no account needed, the link below is yours alone.',
      { label: 'Respond to the invitation', url: this.link('/rsvp', params.token) },
    );
  }

  /**
   * The outcome of a field verification. An applicant is always told the
   * reason when the answer is anything other than yes — being left guessing
   * after a home or office visit is the fastest way to lose them.
   */
  async sendVerificationOutcome(params: {
    to: string;
    applicantType: string;
    status: string;
    remarks: string | null;
  }): Promise<void> {
    const approved = params.status === 'approved';
    const heading = approved
      ? 'Your verification is complete'
      : 'An update on your verification';
    const outcome = params.status.replace(/_/g, ' ');
    const body = approved
      ? `Your ${params.applicantType} account has been verified. You now have full operational access.`
      : [
          `Your ${params.applicantType} verification could not be completed.`,
          '',
          `Outcome: ${outcome}.`,
          params.remarks ? `Reason: ${params.remarks}` : '',
          '',
          'You can correct the details and ask for another visit.',
        ]
          .filter((line, i, all) => line !== '' || all[i - 1] !== '')
          .join('\n');

    await this.send(params.to, heading, 'Hello,', body);
  }

  /**
   * Credentials for an account the platform created after a match was fixed.
   * The password is single-use: the first sign-in forces a reset, which is why
   * it is safe to send it at all.
   */
  async sendProvisionedCredentials(params: {
    to: string;
    name: string;
    temporaryPassword: string;
  }): Promise<void> {
    const body = [
      'Your match has been confirmed and your account is now open.',
      '',
      'Sign in with this address and the temporary password below. You will be asked to',
      'choose your own password straight away, and this one stops working the moment you do.',
      '',
      `Temporary password: ${params.temporaryPassword}`,
    ].join('\n');

    await this.send(params.to, 'Your WOW account is ready', `Hello ${params.name},`, body, {
      label: 'Sign in',
      url: `${this.cfg.mail.appBaseUrl.replace(/[/]+$/, '')}/login`,
    });
  }

  async sendAgentApprovalResult(params: {
    to: string;
    agencyName: string;
    approved: boolean;
    reason?: string;
  }): Promise<void> {
    await this.send(
      params.to,
      params.approved ? 'Your agency has been approved' : 'Your agency application was not approved',
      `Hello ${params.agencyName},`,
      params.approved
        ? 'Your agency is approved. You can now build client profiles, send invitations and place bookings on their behalf.'
        : `Your application was not approved.${params.reason ? ` Reason: ${params.reason}` : ''} You can update your details and resubmit.`,
    );
  }
}
