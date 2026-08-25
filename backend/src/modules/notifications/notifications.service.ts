import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationType } from '../../common/enums';
import { NOTIFICATION_TARGET } from './notification-targets';

// The id column is a uuid, and some payload keys carry things that are not
// one — a profile id is, a preview string is not. Checked rather than cast,
// because a malformed uuid fails the insert and loses the notification.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification) private readonly repo: Repository<Notification>,
  ) {}

  /**
   * Writes one notification, and stamps where it goes.
   *
   * The destination is looked up from the type rather than passed in, so a
   * caller cannot send a booking notification that opens the planner, and every
   * caller gets deep links without knowing they exist.
   */
  create(userId: string, type: NotificationType, payload: Record<string, unknown>) {
    const target = NOTIFICATION_TARGET[type];
    const raw = target.idKey ? payload[target.idKey] : null;
    return this.repo.save(
      this.repo.create({
        userId,
        type,
        payload,
        targetModule: target.module,
        targetAction: target.action,
        targetId: typeof raw === 'string' && UUID.test(raw) ? raw : null,
      }),
    );
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
