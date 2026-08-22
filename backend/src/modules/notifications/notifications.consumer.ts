import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { EventBus } from '../../platform/events/event-bus.service';
import { NotificationsService } from './notifications.service';
import { Profile } from '../users/entities/profile.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { ServiceDefinition } from '../catalog/entities/service-definition.entity';
import { NotificationType, ProviderType } from '../../common/enums';

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
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(VendorService) private readonly services: Repository<VendorService>,
    @InjectRepository(ServiceDefinition)
    private readonly definitions: Repository<ServiceDefinition>,
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

    // ------------------------------------------------------------- bookings
    //
    // Every one of these existed as an outbox event and reached nobody. A
    // vendor's whole working day arrives through these, and the one that
    // matters most is the first: a request nobody told them about is a request
    // they answer three days late.
    const bookingEvents: { event: string; type: NotificationType; to: 'seller' | 'buyer' | 'both' }[] =
      [
        { event: 'booking.requested', type: NotificationType.BOOKING_REQUEST, to: 'seller' },
        { event: 'booking.quotation_sent', type: NotificationType.BOOKING_QUOTATION, to: 'buyer' },
        {
          event: 'booking.quotation_accepted',
          type: NotificationType.BOOKING_QUOTATION,
          to: 'seller',
        },
        { event: 'booking.confirmed', type: NotificationType.BOOKING_CONFIRMED, to: 'buyer' },
        { event: 'booking.payment_held', type: NotificationType.BOOKING_PAYMENT, to: 'seller' },
        { event: 'booking.started', type: NotificationType.BOOKING_STARTED, to: 'buyer' },
        { event: 'booking.work_completed', type: NotificationType.BOOKING_COMPLETED, to: 'buyer' },
        { event: 'booking.cancelled', type: NotificationType.BOOKING_CANCELLED, to: 'both' },
      ];

    for (const { event, type, to } of bookingEvents) {
      this.bus.on<{ bookingId: string }>(event).subscribe((e) => {
        void this.notifyBooking(e.payload.bookingId, type, to, e.payload).catch((err) =>
          this.logger.error(`notify ${event} failed`, err),
        );
      });
    }
  }

  /**
   * Tells whichever side of a booking needs to know.
   *
   * The event payloads are thin — most carry a booking id and little else — so
   * the row is read here rather than every publisher being made to duplicate
   * the same fields. The notification then carries enough for the list to be
   * readable without opening anything: who, what service, which date, which
   * window, and a short reference somebody can quote on the phone.
   */
  private async notifyBooking(
    bookingId: string,
    type: NotificationType,
    to: 'seller' | 'buyer' | 'both',
    extra: Record<string, unknown>,
  ): Promise<void> {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) return;

    const sellerUserId = await this.providerOwner(booking);
    const recipients = new Set<string>();
    if (to !== 'buyer' && sellerUserId) recipients.add(sellerUserId);
    if (to !== 'seller') recipients.add(booking.userId);

    // A directed event already encodes who did it — a request goes to the
    // seller precisely because the buyer sent it — so nothing needs
    // suppressing there. Only a `both` event can reach its own author, and for
    // those the payload names them.
    if (to === 'both' && typeof extra.cancelledBy === 'string') {
      recipients.delete(extra.cancelledBy);
    }
    if (recipients.size === 0) return;

    const [buyerProfile, serviceName] = await Promise.all([
      this.profiles.findOne({ where: { userId: booking.userId } }),
      this.serviceName(booking),
    ]);

    const payload = {
      ...extra,
      bookingId: booking.id,
      // Short enough to read out, long enough not to collide in one vendor's book.
      reference: booking.id.slice(0, 8),
      status: booking.status,
      clientName: buyerProfile?.displayName ?? 'A client',
      service: serviceName,
      eventDate: booking.eventDate,
      slotId: booking.slotId,
      amount: booking.amount,
      currency: booking.currency,
    };

    for (const userId of recipients) {
      await this.notifications.create(userId, type, payload);
    }
  }

  private async providerOwner(booking: Booking): Promise<string | null> {
    if (booking.providerType === ProviderType.VENDOR) {
      const vendor = await this.vendors.findOne({ where: { id: booking.providerId } });
      return vendor?.ownerUserId ?? null;
    }
    const planner = await this.planners.findOne({ where: { id: booking.providerId } });
    return planner?.ownerUserId ?? null;
  }

  /** What was booked, in words. Falls back gracefully for pre-catalog rows. */
  private async serviceName(booking: Booking): Promise<string | null> {
    if (!booking.vendorServiceId) return null;
    const service = await this.services.findOne({ where: { id: booking.vendorServiceId } });
    if (!service) return null;
    if (service.displayName) return service.displayName;
    const definition = await this.definitions.findOne({ where: { id: service.definitionId } });
    return definition?.name ?? null;
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
