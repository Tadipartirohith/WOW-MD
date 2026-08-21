import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationType } from '../../common/enums';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification) private readonly repo: Repository<Notification>,
  ) {}

  create(userId: string, type: NotificationType, payload: Record<string, unknown>) {
    return this.repo.save(this.repo.create({ userId, type, payload }));
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
