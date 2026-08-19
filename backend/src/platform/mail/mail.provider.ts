import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { AppConfigService } from '../../config/app-config.service';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Pluggable mail transport, chosen by MAIL_PROVIDER, mirroring how payments,
 * media and AI providers are selected. 'log' writes the message (including any
 * action link) to the application log so local and CI runs need no SMTP
 * credentials; 'smtp' sends for real.
 */
export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}

@Injectable()
export class LogMailProvider implements MailProvider {
  private readonly logger = new Logger('Mail');

  async send(message: MailMessage): Promise<void> {
    // The link is the whole point of these emails, so keep the plain-text body
    // intact rather than truncating it.
    this.logger.log(`[mail:log] to=${message.to} subject="${message.subject}"\n${message.text}`);
  }
}

@Injectable()
export class SmtpMailProvider implements MailProvider {
  private readonly logger = new Logger(SmtpMailProvider.name);
  private transporter?: nodemailer.Transporter;

  constructor(private readonly cfg: AppConfigService) {}

  private transport(): nodemailer.Transporter {
    if (!this.transporter) {
      const m = this.cfg.mail;
      this.transporter = nodemailer.createTransport({
        host: m.host,
        port: m.port,
        secure: m.secure,
        auth: m.user ? { user: m.user, pass: m.password } : undefined,
      });
    }
    return this.transporter;
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transport().sendMail({
        from: this.cfg.mail.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (err) {
      // A mail failure must not roll back the action that triggered it — an
      // invitation row already exists and can be resent.
      this.logger.error(`Failed to send "${message.subject}" to ${message.to}`, err as Error);
      throw err;
    }
  }
}

export const MAIL_PROVIDER = 'MAIL_PROVIDER';

export const mailProviderFactory = {
  provide: MAIL_PROVIDER,
  inject: [AppConfigService, LogMailProvider, SmtpMailProvider],
  useFactory: (
    cfg: AppConfigService,
    log: LogMailProvider,
    smtp: SmtpMailProvider,
  ): MailProvider => (cfg.mail.provider === 'smtp' ? smtp : log),
};
