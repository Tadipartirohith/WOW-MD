import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PushToken } from './push-token.entity';
import { PUSH_PROVIDER, PushProvider } from './push.provider';

/**
 * Push notifications, and the device list they go to.
 *
 * Registration is the interesting part rather than the sending. A token is
 * issued by the operating system to an app *installation*, not to a person, so
 * the same token can arrive under a second account when a phone is handed over
 * or somebody signs out and in. It is therefore claimed rather than inserted:
 * whoever registered it last owns it, and the previous owner's row is gone.
 * Anything else sends one person another person's notifications.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @InjectRepository(PushToken) private readonly tokens: Repository<PushToken>,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  /** Claims a device for this account. Idempotent; re-registering refreshes it. */
  async register(userId: string, token: string, platform = 'web'): Promise<{ registered: true }> {
    const existing = await this.tokens.findOne({ where: { token } });
    if (existing) {
      existing.userId = userId;
      existing.platform = platform;
      existing.lastSeenAt = new Date();
      await this.tokens.save(existing);
      return { registered: true };
    }
    await this.tokens.save(
      this.tokens.create({ userId, token, platform, lastSeenAt: new Date() }),
    );
    return { registered: true };
  }

  /** Signing out on a device should stop it ringing. */
  async unregister(userId: string, token: string): Promise<{ removed: number }> {
    const result = await this.tokens.delete({ userId, token });
    return { removed: result.affected ?? 0 };
  }

  async devicesFor(userId: string): Promise<number> {
    return this.tokens.count({ where: { userId } });
  }

  /**
   * Sends to every device this account has, and never throws.
   *
   * The caller has already written the notification row. Letting a Firebase
   * outage roll that back would lose the notification entirely, which is worse
   * than a silent phone — the feed still has it.
   */
  async sendToUser(
    userId: string,
    title: string,
    body: string,
    data: Record<string, string> = {},
  ): Promise<{ delivered: number }> {
    try {
      const rows = await this.tokens.find({ where: { userId } });
      if (rows.length === 0) return { delivered: 0 };

      const result = await this.provider.send({
        tokens: rows.map((r) => r.token),
        title,
        body,
        data,
      });

      // Dead tokens are deleted rather than retried. One from an uninstalled
      // app fails on every send forever, and a table of them makes each
      // notification slower than the last.
      if (result.expired.length) {
        await this.tokens.delete({ token: In(result.expired) });
        this.logger.log(`Dropped ${result.expired.length} dead device token(s)`);
      }
      return { delivered: result.delivered };
    } catch (err) {
      this.logger.warn(`Push to ${userId} failed: ${(err as Error).message}`);
      return { delivered: 0 };
    }
  }
}
