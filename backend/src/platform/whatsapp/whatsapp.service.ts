import { Inject, Injectable, Logger } from '@nestjs/common';
import { WHATSAPP_PROVIDER, WhatsAppProvider } from './whatsapp.provider';
import { AppConfigService } from '../../config/app-config.service';

/**
 * WhatsApp, which nobody gets unless they asked for it.
 *
 * The opt-in is checked by the caller, which holds the account row — this
 * service is the transport. What it enforces is the other half of the rule: a
 * number the platform has, a template that exists, and a language the template
 * was approved in.
 *
 * Sending never throws. Every caller here has already done the thing the
 * message is about; a Meta outage must not roll that back.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    private readonly cfg: AppConfigService,
  ) {}

  async send(to: string | null, template: string, params: string[]): Promise<boolean> {
    if (!to) return false;
    try {
      await this.provider.send({
        to: this.e164(to),
        template,
        params,
        language: this.cfg.whatsapp.language,
      });
      return true;
    } catch (err) {
      this.logger.warn(`WhatsApp to ${to} failed: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Puts an Indian number into the form a gateway will accept.
   *
   * Numbers are stored as people typed them, which for this market means with
   * or without +91, with or without a leading zero, sometimes with spaces. A
   * gateway rejects all but one of those, so the normalisation happens here
   * rather than being demanded of every caller.
   */
  private e164(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return `${this.cfg.whatsapp.defaultCountryCode}${digits}`;
    if (digits.length === 11 && digits.startsWith('0')) {
      return `${this.cfg.whatsapp.defaultCountryCode}${digits.slice(1)}`;
    }
    return digits;
  }
}
