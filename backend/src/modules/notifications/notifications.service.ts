import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationType } from '../../common/enums';
import { NOTIFICATION_TARGET } from './notification-targets';
import { DELIVERY } from './notification-delivery';
import { User } from '../auth/entities/user.entity';
import { PushService } from '../../platform/push/push.service';
import { WhatsAppService } from '../../platform/whatsapp/whatsapp.service';

// The id column is a uuid, and some payload keys carry things that are not
// one — a profile id is, a preview string is not. Checked rather than cast,
// because a malformed uuid fails the insert and loses the notification.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification) private readonly repo: Repository<Notification>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly push: PushService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  /**
   * Writes one notification, stamps where it goes, and puts it on whatever
   * channels the recipient has.
   *
   * The destination is looked up from the type rather than passed in, so a
   * caller cannot send a booking notification that opens the planner, and every
   * caller gets deep links without knowing they exist.
   *
   * The row is saved first and returned immediately; the phone and WhatsApp
   * are reached afterwards, deliberately without being awaited. A vendor's
   * booking must not fail because Firebase is down, and the notification is in
   * the feed either way — the outbound channels are a courtesy on top of a
   * record that already exists.
   */
  async create(userId: string, type: NotificationType, payload: Record<string, unknown>) {
    const target = NOTIFICATION_TARGET[type];
    const raw = target.idKey ? payload[target.idKey] : null;
    const saved = await this.repo.save(
      this.repo.create({
        userId,
        type,
        payload,
        targetModule: target.module,
        targetAction: target.action,
        targetId: typeof raw === 'string' && UUID.test(raw) ? raw : null,
      }),
    );

    void this.fanOut(saved.id, userId, type, payload).catch((err) =>
      this.logger.warn(`Delivering notification ${saved.id} failed: ${(err as Error).message}`),
    );
    return saved;
  }

  /**
   * The channels beyond the feed.
   *
   * Push goes to anybody with a registered device — that registration *is* the
   * consent, and it can be withdrawn by signing out. WhatsApp goes only to
   * somebody who explicitly asked for it, and only for the handful of
   * notification types with an approved template: money and jobs. Everything
   * else stays in the app, which is where a matrimony notification belongs.
   */
  private async fanOut(
    notificationId: string,
    userId: string,
    type: NotificationType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const spec = DELIVERY[type];
    if (!spec) return;

    const body = spec.body(payload);
    await this.push.sendToUser(userId, spec.title, body, {
      notificationId,
      type,
      // Strings only: FCM carries nothing else, and a value that arrives as a
      // number on one platform and a string on another breaks on somebody's
      // phone rather than in testing.
      targetModule: NOTIFICATION_TARGET[type].module,
      targetAction: NOTIFICATION_TARGET[type].action,
      targetId: typeof payload[NOTIFICATION_TARGET[type].idKey ?? ''] === 'string'
        ? String(payload[NOTIFICATION_TARGET[type].idKey ?? ''])
        : '',
    });

    if (!spec.whatsappTemplate) return;

    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'phone', 'whatsappOptIn'],
    });
    if (!user?.whatsappOptIn || !user.phone) return;

    await this.whatsapp.send(
      user.phone,
      spec.whatsappTemplate,
      spec.whatsappParams ? spec.whatsappParams(payload) : [],
    );
  }

  /**
   * Turning WhatsApp on or off, for the account itself.
   *
   * The date is recorded on the way in and left alone on the way out, so the
   * question asked afterwards — did they agree, and when — still has an answer
   * for somebody who later changed their mind.
   */
  /**
   * What this account can actually be reached on.
   *
   * The device count comes from the caller rather than being looked up here,
   * because the push module owns the token table and this service owns the
   * preference — asking each for its own half keeps the two from needing to
   * know about each other's storage.
   */
  async channels(userId: string, devices: number) {
    const user = await this.users.findOne({
      where: { id: userId },
      select: ['id', 'phone', 'whatsappOptIn', 'whatsappOptInAt'],
    });
    return {
      devices,
      whatsappOptIn: Boolean(user?.whatsappOptIn),
      whatsappOptInAt: user?.whatsappOptInAt ?? null,
      // Said plainly rather than left for the client to work out: opting in
      // with no number on the account does nothing, and a switch that turns on
      // and changes nothing is worse than one that explains itself.
      whatsappReachable: Boolean(user?.whatsappOptIn && user?.phone),
    };
  }

  async setWhatsApp(userId: string, optIn: boolean) {
    await this.users.update(userId, {
      whatsappOptIn: optIn,
      ...(optIn ? { whatsappOptInAt: new Date() } : {}),
    });
    return { whatsappOptIn: optIn };
  }

  listForUser(userId: string) {
    return this.repo.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 100 });
  }

  /** What the bell shows. Cheap enough to poll. */
  async unreadCount(userId: string): Promise<{ unread: number }> {
    return { unread: await this.repo.count({ where: { userId, isRead: false } }) };
  }

  async markRead(userId: string, id: string) {
    await this.repo.update({ id, userId }, { isRead: true });
    return { success: true };
  }

  /**
   * Clear the lot. Somebody coming back from a week away has forty of these and
   * will not tap each one; without this they simply stop looking at the bell.
   */
  async markAllRead(userId: string) {
    const result = await this.repo.update({ userId, isRead: false }, { isRead: true });
    return { success: true, marked: result.affected ?? 0 };
  }
}
