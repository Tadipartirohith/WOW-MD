import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

export interface PushMessage {
  /** Device registration tokens. One message, many devices — people have several. */
  tokens: string[];
  title: string;
  body: string;
  /**
   * Where tapping it goes, as flat string pairs.
   *
   * FCM only carries strings in the data payload, and a number that arrives as
   * `"3"` on one platform and `3` on another is the sort of thing that works in
   * testing and breaks on somebody's phone.
   */
  data: Record<string, string>;
}

export interface PushResult {
  /** How many devices took it. */
  delivered: number;
  /**
   * Tokens the service says are dead.
   *
   * Returned rather than logged because the caller has to delete them: a token
   * from an uninstalled app fails on every send forever, and a table full of
   * them makes every notification slower than the last.
   */
  expired: string[];
}

/**
 * Pluggable push transport, chosen by PUSH_PROVIDER, exactly as mail and SMS are.
 *
 * `log` writes to the application log, so local and CI runs need no Firebase
 * project; `fcm` posts to Firebase Cloud Messaging, which covers Android and
 * iOS alike and is what a React Native or web client would already be using.
 */
export interface PushProvider {
  send(message: PushMessage): Promise<PushResult>;
}

@Injectable()
export class LogPushProvider implements PushProvider {
  private readonly logger = new Logger('Push');

  async send(message: PushMessage): Promise<PushResult> {
    this.logger.log(
      `[push:log] devices=${message.tokens.length} "${message.title}" — ${message.body} ` +
        `${JSON.stringify(message.data)}`,
    );
    // The default mirrors the real rule rather than pretending everything
    // worked: a message with no devices delivered to nobody, and code that
    // reports otherwise hides an empty token table until production.
    return { delivered: message.tokens.length, expired: [] };
  }
}

@Injectable()
export class FcmPushProvider implements PushProvider {
  private readonly logger = new Logger(FcmPushProvider.name);

  constructor(private readonly cfg: AppConfigService) {}

  async send(message: PushMessage): Promise<PushResult> {
    const push = this.cfg.push;
    if (!push.serverKey) {
      // Loud rather than quiet: a deployment that meant to send push and did
      // not configure it should find out on the first notification, not from a
      // vendor who never heard about a booking.
      throw new Error('PUSH_SERVER_KEY must be set when PUSH_PROVIDER=fcm');
    }
    if (message.tokens.length === 0) return { delivered: 0, expired: [] };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), push.timeoutMs);
    try {
      const response = await fetch(push.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `key=${push.serverKey}`,
        },
        body: JSON.stringify({
          registration_ids: message.tokens,
          notification: { title: message.title, body: message.body },
          data: message.data,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`Push service returned ${response.status}`);

      const payload = (await response.json()) as {
        success?: number;
        results?: { error?: string }[];
      };

      // Positional: FCM's results array lines up with the tokens that were
      // sent, which is the only way to know *which* token is dead.
      const expired = (payload.results ?? [])
        .map((r, i) =>
          r.error === 'NotRegistered' || r.error === 'InvalidRegistration' ? message.tokens[i] : null,
        )
        .filter((t): t is string => Boolean(t));

      return { delivered: payload.success ?? 0, expired };
    } catch (err) {
      this.logger.error(`Push to ${message.tokens.length} device(s) failed`, err as Error);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const PUSH_PROVIDER = 'PUSH_PROVIDER';

export const pushProviderFactory = {
  provide: PUSH_PROVIDER,
  inject: [AppConfigService, LogPushProvider, FcmPushProvider],
  useFactory: (cfg: AppConfigService, log: LogPushProvider, fcm: FcmPushProvider): PushProvider =>
    cfg.push.provider === 'fcm' ? fcm : log,
};
