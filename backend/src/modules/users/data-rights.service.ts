import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, LessThan, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Profile } from './entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { ProfileSibling } from '../profile-details/entities/profile-sibling.entity';
import { ProfileAsset } from '../profile-details/entities/profile-asset.entity';
import { ProfileConsent } from '../circulation/entities/profile-consent.entity';
import { ProfileShare } from '../circulation/entities/profile-share.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Invitation } from '../invitations/entities/invitation.entity';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { BookingStatus, ProfileClaimStatus, ProfileLifecycle } from '../../common/enums';

/**
 * How long an unclaimed profile may sit before it is purged.
 *
 * A profile built for somebody who was never invited, or who never accepted, is
 * personal data held on a person who has not agreed to anything beyond intake.
 * Two years is generous for a marriage search and short enough to be a real
 * retention limit rather than a gesture.
 */
const UNCLAIMED_RETENTION_DAYS = 730;

/**
 * Export and erasure.
 *
 * Consent was already recorded properly — who gave it, how, when, in which
 * scope, and how to withdraw it. What was missing was the other half: a person
 * being able to see everything held about them, and to have it removed.
 *
 * Erasure here is real deletion of the personal record, not a flag. What
 * survives is deliberately narrow and named in `erase()` below: money and
 * consent history have to outlive the person's profile, or the platform cannot
 * answer for what it did.
 */
@Injectable()
export class DataRightsService {
  private readonly logger = new Logger(DataRightsService.name);

  constructor(
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ProfileDetails) private readonly details: Repository<ProfileDetails>,
    @InjectRepository(ProfileSibling) private readonly siblings: Repository<ProfileSibling>,
    @InjectRepository(ProfileAsset) private readonly assets: Repository<ProfileAsset>,
    @InjectRepository(ProfileConsent) private readonly consents: Repository<ProfileConsent>,
    @InjectRepository(ProfileShare) private readonly shares: Repository<ProfileShare>,
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Invitation) private readonly invitations: Repository<Invitation>,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Everything held about this account, in one JSON document.
   *
   * Deliberately not paginated and not filtered: the point of an export is that
   * it is complete, and a person who asks what you hold about them is owed the
   * whole answer rather than a readable summary of it.
   */
  async export(actor: AuthUser): Promise<Record<string, unknown>> {
    const user = await this.users.findOne({ where: { id: actor.userId } });
    const profile = await this.profiles.findOne({ where: { userId: actor.userId } });

    const [details, siblings, assets, consents, shares, interests, bookings] = profile
      ? await Promise.all([
          this.details.findOne({ where: { profileId: profile.id } }),
          this.siblings.find({ where: { profileId: profile.id } }),
          this.assets.find({ where: { profileId: profile.id } }),
          this.consents.find({ where: { profileId: profile.id } }),
          this.shares.find({ where: { profileId: profile.id } }),
          this.interests.find({
            where: [{ fromProfileId: profile.id }, { toProfileId: profile.id }],
          }),
          this.bookings.find({ where: { userId: actor.userId } }),
        ])
      : [null, [], [], [], [], [], await this.bookings.find({ where: { userId: actor.userId } })];

    await this.audit.record({
      action: AuditAction.DATA_EXPORTED,
      actor,
      resourceType: 'user',
      resourceId: actor.userId,
    });

    return {
      exportedAt: new Date().toISOString(),
      account: user
        ? {
            id: user.id,
            email: user.email,
            phone: user.phone,
            role: user.role,
            isActive: user.isActive,
            isVerified: user.isVerified,
            phoneVerifiedAt: user.phoneVerifiedAt,
            mfaEnabled: user.mfaEnabled,
            managedByAgentId: user.managedByAgentId,
            createdAt: user.createdAt,
          }
        : null,
      profile,
      biodata: details,
      siblings,
      familyAssets: assets,
      // The consent record is the most useful part of an export: it is the
      // evidence of what was agreed to, and it is the thing people dispute.
      consents,
      circulation: shares,
      interests,
      bookings,
    };
  }

  /**
   * Erases the personal record, keeping only what must survive.
   *
   * Refused while money is in flight. Deleting the buyer of a booking with
   * escrow held would strand real money with nobody to return it to, and "we
   * deleted you and kept your fifty thousand rupees" is not a defensible
   * outcome for anybody.
   */
  async erase(actor: AuthUser, password: string): Promise<{ erased: true }> {
    const user = await this.users.findOne({
      where: { id: actor.userId },
      select: ['id', 'email', 'role', 'passwordHash'],
    });
    if (!user) throw new BadRequestException('Account not found');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new BadRequestException('Password is not correct');

    const live = await this.bookings.count({
      where: {
        userId: actor.userId,
        status: In([
          BookingStatus.PAYMENT_PENDING,
          BookingStatus.PENDING,
          BookingStatus.CONFIRMED,
          BookingStatus.IN_PROGRESS,
          BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT,
          BookingStatus.DISPUTED,
        ]),
      },
    });
    if (live > 0) {
      throw new BadRequestException(
        'You have bookings still in progress. Settle or cancel them before deleting your account.',
      );
    }

    const profile = await this.profiles.findOne({ where: { userId: actor.userId } });

    await this.dataSource.transaction(async (manager) => {
      if (profile) {
        await manager.getRepository(ProfileSibling).delete({ profileId: profile.id });
        await manager.getRepository(ProfileAsset).delete({ profileId: profile.id });
        await manager.getRepository(ProfileDetails).delete({ profileId: profile.id });
        await manager.getRepository(ProfileShare).delete({ profileId: profile.id });
        await manager.getRepository(Invitation).delete({ profileId: profile.id });
        await manager
          .getRepository(Interest)
          .delete([{ fromProfileId: profile.id }, { toProfileId: profile.id }]);

        // The profile row itself goes; the consent rows stay. Consent is the
        // record of what an agency was permitted to do and is the evidence in
        // any later complaint — erasing it would erase the proof alongside the
        // person it protects.
        await manager.getRepository(Profile).delete({ id: profile.id });
      }

      // The account is anonymised rather than deleted, because bookings,
      // payments and audit rows reference it and orphaning them would break the
      // financial record. What is removed is everything that identifies a
      // person; what is left is a shell that money can still be traced to.
      await manager.getRepository(User).update(actor.userId, {
        email: `erased+${actor.userId}@wow.invalid`,
        phone: null,
        passwordHash: await bcrypt.hash(`${actor.userId}-${Date.now()}`, 10),
        isActive: false,
        mfaEnabled: false,
        mfaSecret: null,
        phoneVerifiedAt: null,
      });
    });

    await this.audit.record({
      action: AuditAction.DATA_ERASED,
      actor,
      resourceType: 'user',
      resourceId: actor.userId,
      metadata: { profileId: profile?.id ?? null },
    });

    return { erased: true };
  }

  /**
   * Purges profiles built for people who never became users.
   *
   * A profile taken at an office, never invited or never accepted, is personal
   * data about somebody who agreed only to be taken on — not to be held
   * indefinitely. Run on a schedule; returns what it removed so the job can log
   * it rather than deleting quietly.
   */
  async purgeStaleUnclaimed(): Promise<{ purged: number }> {
    const cutoff = new Date(Date.now() - UNCLAIMED_RETENTION_DAYS * 86_400_000);
    const stale = await this.profiles.find({
      where: {
        userId: IsNull(),
        claimStatus: In([ProfileClaimStatus.UNCLAIMED, ProfileClaimStatus.INVITED]),
        createdAt: LessThan(cutoff),
        lifecycle: ProfileLifecycle.ARCHIVED,
      },
      take: 200,
    });
    if (stale.length === 0) return { purged: 0 };

    const ids = stale.map((p) => p.id);
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(ProfileSibling).delete({ profileId: In(ids) });
      await manager.getRepository(ProfileAsset).delete({ profileId: In(ids) });
      await manager.getRepository(ProfileDetails).delete({ profileId: In(ids) });
      await manager.getRepository(ProfileShare).delete({ profileId: In(ids) });
      await manager.getRepository(Invitation).delete({ profileId: In(ids) });
      await manager
        .getRepository(Interest)
        .delete([{ fromProfileId: In(ids) }, { toProfileId: In(ids) }]);
      await manager.getRepository(Profile).delete({ id: In(ids) });
    });

    this.logger.log(`Purged ${ids.length} unclaimed profile(s) past the retention limit`);
    return { purged: ids.length };
  }
}
