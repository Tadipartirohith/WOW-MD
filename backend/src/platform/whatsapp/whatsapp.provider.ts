import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

export interface WhatsAppMessage {
  /** E.164, as every gateway requires. */
  to: string;
  /**
   * The registered template name. Not free text, and deliberately not
   * optional.
   *
   * A business-initiated WhatsApp message outside a 24-hour customer service
   * window has to be one of the templates the number has had approved — Meta
   * refuses anything else, and in India the same content also has to be
   * DLT-registered. So the interface takes a template and its parameters
   * rather than a body: a signature that accepts a string invites callers to
   * write one, and every one of those is a message that will not send.
   */
  template: string;
  /** Positional substitutions, in the order the template declares them. */
  params: string[];
  /** Template language, e.g. `en` or `en_US`. */
  language: string;
}

export interface WhatsAppProvider {
  send(message: WhatsAppMessage): Promise<void>;
}

@Injectable()
export class LogWhatsAppProvider implements WhatsAppProvider {
  private readonly logger = new Logger('WhatsApp');

  async send(message: WhatsAppMessage): Promise<void> {
    // Logged as the template plus its parameters rather than as an assembled
    // sentence, because that is what actually goes to Meta — a default that
    // renders the message would hide a template mismatch until the real
    // provider was switched on.
    this.logger.log(
      `[whatsapp:log] to=${message.to} template=${message.template}(${message.language}) ` +
        `params=${JSON.stringify(message.params)}`,
    );
  }
}

@Injectable()
export class CloudApiWhatsAppProvider implements WhatsAppProvider {
  private readonly logger = new Logger(CloudApiWhatsAppProvider.name);

  constructor(private readonly cfg: AppConfigService) {}

  async send(message: WhatsAppMessage): Promise<void> {
    const wa = this.cfg.whatsapp;
    if (!wa.token || !wa.phoneNumberId) {
      throw new Error(
        'WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be set when WHATSAPP_PROVIDER=cloud',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), wa.timeoutMs);
    try {
      const response = await fetch(`${wa.baseUrl}/${wa.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${wa.token}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: message.to,
          type: 'template',
          template: {
            name: message.template,
            language: { code: message.language },
            components: message.params.length
              ? [
                  {
                    type: 'body',
                    parameters: message.params.map((text) => ({ type: 'text', text })),
                  },
                ]
              : [],
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`WhatsApp returned ${response.status}${detail ? `: ${detail}` : ''}`);
      }
    } catch (err) {
      this.logger.error(`WhatsApp to ${message.to} failed`, err as Error);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER';

export const whatsappProviderFactory = {
  provide: WHATSAPP_PROVIDER,
  inject: [AppConfigService, LogWhatsAppProvider, CloudApiWhatsAppProvider],
  useFactory: (
    cfg: AppConfigService,
    log: LogWhatsAppProvider,
    cloud: CloudApiWhatsAppProvider,
  ): WhatsAppProvider => (cfg.whatsapp.provider === 'cloud' ? cloud : log),
};
