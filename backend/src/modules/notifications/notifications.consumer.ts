import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../platform/events/event-bus.service';
import { NotificationsService } from './notifications.service';
import { NotificationType } from '../../common/enums';

/**
 * Translates domain events (delivered via the outbox to event bus) into user
 * notifications. This is the seam where SMS/email/push fan-out plugs in later.
 */
@Injectable()
export class NotificationsConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotificationsConsumer.name);

  constructor(
    private readonly bus: EventBus,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.bus.on<{ toUserId: string; fromUserId: string }>('match.interest_sent').subscribe((e) => {
      void this.notifications
        .create(e.payload.toUserId, NotificationType.MATCH_INTEREST, e.payload)
        .catch((err) => this.logger.error('notify interest failed', err));
    });

    this.bus.on<{ userA: string; userB: string }>('match.accepted').subscribe((e) => {
      void this.notifications
        .create(e.payload.userA, NotificationType.MATCH_ACCEPTED, e.payload)
        .catch((err) => this.logger.error('notify accepted failed', err));
    });
  }
}
