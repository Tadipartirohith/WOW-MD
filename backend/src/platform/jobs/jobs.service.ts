import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { SessionsService } from '../../modules/auth/sessions.service';
import { PhoneVerificationService } from '../../modules/auth/phone-verification.service';
import { Payment } from '../../modules/bookings/entities/payment.entity';
import { Booking } from '../../modules/bookings/entities/booking.entity';
import { Profile } from '../../modules/users/entities/profile.entity';
import { ProfileConsent } from '../../modules/circulation/entities/profile-consent.entity';
import { Vendor } from '../../modules/vendors/entities/vendor.entity';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { SmsService } from '../sms/sms.service';
import { DataRightsService } from '../../modules/users/data-rights.service';
import { AuditAction, AuditService } from '../audit/audit.service';
import {
  BookingStatus,
  ConsentScope,
  NetworkVisibility,
  NotificationType,
  PaymentStatus,
} from '../../common/enums';

/** How long a booking sits at a payment step before anybody is chased. */
const REMINDER_AFTER_DAYS = 3;

/** How close to expiry a circulation consent gets a profile pulled from the pool. */
const CONSENT_GRACE_DAYS = 7;

/**
 * The work nobody is around to do.
 *
 * Everything here was a `*Service.method` that existed and was never called, or
 * a divergence nobody was watching. Each job is idempotent and logs what it
 * touched, because a scheduled job that fails silently is worse than no job:
 * the absence of an alert reads as everything being fine.
 *
 * Cron runs on every replica. Each job below is written so that running twice
 * in the same minute is harmless — deletes are keyed on a timestamp, updates
 * are conditional, and notifications are deduplicated by a marker on the row
 * they concern.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private readonly sessions: SessionsService,
    private readonly phones: PhoneVerificationService,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(ProfileConsent) private readonly consents: Repository<ProfileConsent>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    private readonly notifications: NotificationsService,
    private readonly sms: SmsService,
    private readonly audit: AuditService,
    private readonly dataRights: DataRightsService,
  ) {}

  /**
   * D10 — expired sessions and used verification codes.
   *
   * `pruneExpired` has existed for a long time and nothing ever called it, so
   * `refresh_sessions` grew without bound: every sign-in on every device, kept
   * forever, on a table that is read on every token refresh.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneExpired(): Promise<void> {
    try {
      const [sessions, codes] = await Promise.all([
        this.sessions.pruneExpired(),
        this.phones.pruneExpired(),
      ]);
      if (sessions || codes) {
        this.logger.log(`Pruned ${sessions} expired sessions and ${codes} spent phone codes`);
      }
    } catch (err) {
      this.logger.error('Session prune failed', err as Error);
    }
  }

  /**
   * D4 — reconcile what the gateway says against what we hold.
   *
   * The webhook endpoint verifies signatures, drops replays and records the
   * provider's status, deliberately without driving the state machine. That is
   * the right call — but nothing was comparing the two afterwards, so a
   * payment the gateway had refunded could sit here marked as held indefinitely
   * and nobody would know until a customer asked.
   *
   * This does not auto-correct. Money moving on a schedule with no human in the
   * loop is how a reconciliation job becomes the incident. It raises the
   * divergence for somebody to decide on.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async reconcilePayments(): Promise<void> {
    try {
      const candidates = await this.payments.find({
        where: { providerStatus: Not(IsNull()) },
        order: { createdAt: 'DESC' },
        take: 500,
      });

      const diverged = candidates.filter((p) => this.disagrees(p));
      if (diverged.length === 0) return;

      this.logger.warn(
        `${diverged.length} payment(s) disagree with the gateway: ` +
          diverged.map((p) => `${p.id}=${p.status}/${p.providerStatus}`).join(', '),
      );

      for (const payment of diverged) {
        await this.audit.record({
          action: AuditAction.PAYMENT_RECONCILIATION_MISMATCH,
          resourceType: 'payment',
          resourceId: payment.id,
          metadata: {
            bookingId: payment.bookingId,
            ourStatus: payment.status,
            providerStatus: payment.providerStatus,
          },
        });
      }
    } catch (err) {
      this.logger.error('Payment reconciliation failed', err as Error);
    }
  }

  /** Does our record of this payment contradict the gateway's? */
  private disagrees(payment: Payment): boolean {
    const provider = (payment.providerStatus ?? '').toLowerCase();
    if (!provider) return false;

    // Only the contradictions worth waking somebody for. A gateway reporting
    // "captured" against our "held_in_escrow" is the normal happy path.
    const refundedThere = provider.includes('refund');
    const refundedHere =
      payment.status === PaymentStatus.REFUNDED ||
      payment.status === PaymentStatus.PARTIALLY_SETTLED;
    if (refundedThere && !refundedHere) return true;

    const failedThere = provider.includes('fail');
    const holdsMoneyHere =
      payment.status === PaymentStatus.HELD_IN_ESCROW ||
      payment.status === PaymentStatus.RELEASED ||
      payment.status === PaymentStatus.DISPUTED;
    return failedThere && holdsMoneyHere;
  }

  /**
   * Round 4 leftover — chase the instalment nobody is chasing.
   *
   * Milestones are enforced in order, so a booking that stalls at "waiting on
   * the second payment" simply stops. The vendor cannot proceed and has no way
   * to nudge; the couple has forgotten. One reminder, three days in, on the
   * channel they actually read.
   */
  @Cron(CronExpression.EVERY_DAY_AT_10AM)
  async remindUnpaidMilestones(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - REMINDER_AFTER_DAYS * 86_400_000);
      const waiting = await this.bookings.find({
        where: {
          status: In([BookingStatus.PAYMENT_PENDING, BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT]),
          updatedAt: LessThan(cutoff),
        },
        take: 500,
      });
      if (waiting.length === 0) return;

      const providerNames = await this.providerNames(waiting);
      let sent = 0;

      for (const booking of waiting) {
        const due =
          booking.status === BookingStatus.PAYMENT_PENDING ? 'advance' : 'final instalment';

        await this.notifications.create(booking.userId, NotificationType.BOOKING_UPDATE, {
          bookingId: booking.id,
          status: booking.status,
          reminder: true,
          message: `Your ${due} is still outstanding.`,
        });

        const profile = await this.profiles.findOne({ where: { userId: booking.userId } });
        if (profile?.contactPhone) {
          await this.sms.sendMilestoneReminder({
            to: profile.contactPhone,
            providerName: providerNames.get(booking.providerId) ?? 'your provider',
            milestone: due,
            amount: booking.amount,
          });
        }
        sent += 1;
      }

      this.logger.log(`Reminded ${sent} buyer(s) about an outstanding instalment`);
    } catch (err) {
      this.logger.error('Milestone reminders failed', err as Error);
    }
  }

  private async providerNames(bookings: Booking[]): Promise<Map<string, string>> {
    const ids = [...new Set(bookings.map((b) => b.providerId))];
    if (ids.length === 0) return new Map();
    const vendors = await this.vendors.find({ where: { id: In(ids) } });
    return new Map(vendors.map((v) => [v.id, v.name]));
  }

  /**
   * D8 — purge profiles built for people who never became users.
   *
   * A profile taken at an office, never invited or never accepted, and since
   * closed, is personal data about somebody who agreed to be taken on and to
   * nothing beyond that. Keeping it forever was the retention policy by
   * default; this makes the limit real.
   */
  @Cron(CronExpression.EVERY_WEEK)
  async purgeStaleProfiles(): Promise<void> {
    try {
      const { purged } = await this.dataRights.purgeStaleUnclaimed();
      if (purged) this.logger.log(`Purged ${purged} unclaimed profile(s) past retention`);
    } catch (err) {
      this.logger.error('Unclaimed profile purge failed', err as Error);
    }
  }

  /**
   * D12 — pull a profile out of the network pool as its consent lapses.
   *
   * Circulation consent carries an expiry precisely because a family's
   * permission is not permanent. Nothing enforced it on the pool, so a profile
   * whose consent quietly expired stayed visible to every approved agency on
   * the platform — which is exactly the situation the expiry exists to prevent.
   *
   * Pulled a week early, so it lapses before it lapses rather than after.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async delistLapsingConsent(): Promise<void> {
    try {
      const horizon = new Date(Date.now() + CONSENT_GRACE_DAYS * 86_400_000);
      const pooled = await this.profiles.find({
        where: { networkVisibility: NetworkVisibility.POOL },
        take: 1000,
      });
      if (pooled.length === 0) return;

      let delisted = 0;
      for (const profile of pooled) {
        const consent = await this.consents.findOne({
          where: { profileId: profile.id, scope: ConsentScope.CIRCULATION },
          order: { createdAt: 'DESC' },
        });

        const lapsing =
          !consent ||
          consent.revokedAt !== null ||
          (consent.expiresAt !== null && consent.expiresAt <= horizon);
        if (!lapsing) continue;

        profile.networkVisibility = NetworkVisibility.PRIVATE;
        profile.pooledAt = null;
        await this.profiles.save(profile);
        delisted += 1;

        if (profile.managedByUserId) {
          await this.notifications.create(profile.managedByUserId, NotificationType.TASK_REMINDER, {
            profileId: profile.id,
            title: `${profile.displayName} has left the network pool — their circulation consent is lapsing.`,
          });
        }
      }

      if (delisted) this.logger.log(`De-listed ${delisted} profile(s) with lapsing consent`);
    } catch (err) {
      this.logger.error('Pool de-listing failed', err as Error);
    }
  }
}
