import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EventBus } from '../../platform/events/event-bus.service';
import { NotificationsService } from './notifications.service';
import { Profile } from '../users/entities/profile.entity';
import { NotificationType } from '../../common/enums';

/**
 * Translates domain events (delivered via the outbox to the event bus) into
 * user notifications. This is the seam where SMS/email/push fan-out plugs in.
 *
 * Matchmaking events carry *profile* ids, not user ids, because a profile an
 * agency built is matchable before its subject has an account. So every
 * notification here starts by asking who to actually tell: the profile's owner
 * if it has one, otherwise the steward who runs it — for a walk-in client the
 * agent is their entire interface, and a notification into the void helps
 * nobody.
 */
@Injectable()
export class NotificationsConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotificationsConsumer.name);

  constructor(
    private readonly bus: EventBus,
    private readonly notifications: NotificationsService,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
  ) {}

  onModuleInit() {
    this.bus
      .on<{ interestId: string; fromProfileId: string; toProfileId: string }>(
        'match.interest_sent',
      )
      .subscribe((e) => {
        void this.notifyProfiles(
          [e.payload.toProfileId],
          NotificationType.MATCH_INTEREST,
          e.payload,
        ).catch((err) => this.logger.error('notify interest failed', err));
      });

    this.bus
      .on<{ interestId: string; profileA: string; profileB: string }>('match.accepted')
      .subscribe((e) => {
        void this.notifyProfiles(
          [e.payload.profileA, e.payload.profileB],
          NotificationType.MATCH_ACCEPTED,
          e.payload,
        ).catch((err) => this.logger.error('notify accepted failed', err));
      });

    this.bus
      .on<{ interestId: string; fromProfileId: string; toProfileId: string }>('match.fixed')
      .subscribe((e) => {
        void this.notifyProfiles(
          [e.payload.fromProfileId, e.payload.toProfileId],
          NotificationType.MATCH_ACCEPTED,
          e.payload,
        ).catch((err) => this.logger.error('notify match fixed failed', err));
      });
  }

  /**
   * Sends one notification per profile, to whoever is actually reachable for
   * it. Duplicates are collapsed: an agency that runs both sides of a match
   * should be told once, not twice.
   */
  private async notifyProfiles(
    profileIds: string[],
    type: NotificationType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const profiles = await this.profiles.find({ where: { id: In(profileIds) } });
    const recipients = new Set(
      profiles
        .map((p) => p.userId ?? p.managedByUserId)
        .filter((id): id is string => Boolean(id)),
    );

    for (const userId of recipients) {
      await this.notifications.create(userId, type, payload);
    }
  }
}
