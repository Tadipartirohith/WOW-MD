import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

export interface SmsMessage {
  /** E.164, because that is the only form a gateway will accept. */
  to: string;
  body: string;
}

/**
 * Pluggable SMS transport, chosen by SMS_PROVIDER, mirroring mail exactly.
 *
 * `log` writes the message to the application log so local and CI runs need no
 * gateway account; `http` posts to a generic gateway. Almost every Indian SMS
 * provider — MSG91, Textlocal, Gupshup, Kaleyra — exposes the same shape: a
 * URL, an API key, a sender id and a template id, so one HTTP provider covers
 * them rather than a class each.
 */
export interface SmsProvider {
  send(message: SmsMessage): Promise<void>;
}

@Injectable()
export class LogSmsProvider implements SmsProvider {
  private readonly logger = new Logger('Sms');

  async send(message: SmsMessage): Promise<void> {
    // The link or the code is the whole point of these messages, so the body
    // is logged intact rather than truncated.
    this.logger.log(`[sms:log] to=${message.to}\n${message.body}`);
  }
}

@Injectable()
export class HttpSmsProvider implements SmsProvider {
  private readonly logger = new Logger(HttpSmsProvider.name);

  constructor(private readonly cfg: AppConfigService) {}

  async send(message: SmsMessage): Promise<void> {
    const sms = this.cfg.sms;
    if (!sms.url || !sms.apiKey) {
      // Refusing loudly beats sending nothing quietly: a deployment that meant
      // to send SMS and did not configure it should find out on the first
      // message, not from a family that never received an invitation.
      throw new Error('SMS_URL and SMS_API_KEY must be set when SMS_PROVIDER=http');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), sms.timeoutMs);
    try {
      const response = await fetch(sms.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sms.apiKey}`,
        },
        body: JSON.stringify({
          sender: sms.senderId,
          template_id: sms.templateId || undefined,
          to: message.to,
          message: message.body,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`SMS gateway returned ${response.status}`);
      }
    } catch (err) {
      // A send failure must not roll back the action that triggered it — an
      // invitation row already exists and can be resent.
      this.logger.error(`Failed to send SMS to ${message.to}`, err as Error);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const SMS_PROVIDER = 'SMS_PROVIDER';

export const smsProviderFactory = {
  provide: SMS_PROVIDER,
  inject: [AppConfigService, LogSmsProvider, HttpSmsProvider],
  useFactory: (cfg: AppConfigService, log: LogSmsProvider, http: HttpSmsProvider): SmsProvider =>
    cfg.sms.provider === 'http' ? http : log,
};
