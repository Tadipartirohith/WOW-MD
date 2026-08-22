import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { ProfileConsent } from './entities/profile-consent.entity';
import { Profile } from '../users/entities/profile.entity';
import { RecordConsentDto, RevokeConsentDto } from './dto/consent.dto';
import { AppConfigService } from '../../config/app-config.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  ConsentScope,
  NetworkVisibility,
  ProfileClaimStatus,
  UserRole,
} from '../../common/enums';

export interface ConsentState {
  intake: ProfileConsent | null;
  circulation: ProfileConsent | null;
  mayCirculate: boolean;
  /** Set when circulation consent exists but has gone stale. */
  needsReconfirmation: boolean;
  reason: string | null;
}

/**
 * Consent for profiles the agency built on somebody else's behalf.
 *
 * The rule the product asked for: holding a walk-in family's details is one
 * agreement, passing those details around is another. So INTAKE consent is
 * required to create the profile at all, and a separate, expiring CIRCULATION
 * consent is required before it leaves the agency — every share, every pool
 * listing, every biodata link checks it.
 *
 * Records are append-only: a re-confirmation writes a new row, so the history
 * of what was agreed and when survives.
 */
@Injectable()
export class ConsentService {
  constructor(
    @InjectRepository(ProfileConsent) private readonly consents: Repository<ProfileConsent>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly cfg: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  /** A profile the caller stewards, or any profile for an admin. */
  private async stewardedProfile(actor: AuthUser, profileId: string): Promise<Profile> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');
    if (actor.role !== UserRole.ADMIN && profile.managedByUserId !== actor.userId) {
      throw new ForbiddenException('That profile is not one you manage');
    }
    return profile;
  }

  private live(rows: ProfileConsent[], scope: ConsentScope): ProfileConsent | null {
    const now = Date.now();
    return (
      rows
        .filter((c) => c.scope === scope)
        .filter((c) => !c.revokedAt)
        .filter((c) => !c.expiresAt || c.expiresAt.getTime() > now)
        // Newest first: a re-confirmation supersedes what came before.
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }

  async stateFor(profileId: string): Promise<ConsentState> {
    const rows = await this.consents.find({ where: { profileId } });
    const intake = this.live(rows, ConsentScope.INTAKE);
    const circulation = this.live(rows, ConsentScope.CIRCULATION);

    // Distinguish "never asked" from "asked, but it has gone stale": the second
    // is a prompt to ring the family back, not a fresh conversation.
    const hadCirculation = rows.some((c) => c.scope === ConsentScope.CIRCULATION);
    const needsReconfirmation = !circulation && hadCirculation;

    let reason: string | null = null;
    if (!intake) reason = 'No intake consent has been recorded for this profile.';
    else if (needsReconfirmation)
      reason = 'Circulation consent has lapsed. Confirm with the family before sharing again.';
    else if (!circulation)
      reason = 'This profile has no circulation consent, so it cannot be shared outside the agency.';

    return {
      intake,
      circulation,
      mayCirculate: Boolean(intake && circulation),
      needsReconfirmation,
      reason,
    };
  }

  /**
   * The same answer for a page of profiles, in one query.
   *
   * A client book of forty profiles was otherwise forty round trips, so the
   * list simply did not say which of them could be circulated — and an agent
   * found out by clicking Circulate and being refused.
   */
  async stateForMany(profileIds: string[]): Promise<Map<string, ConsentState>> {
    const out = new Map<string, ConsentState>();
    if (profileIds.length === 0) return out;

    const rows = await this.consents.find({ where: { profileId: In(profileIds) } });
    for (const profileId of profileIds) {
      const mine = rows.filter((r) => r.profileId === profileId);
      const intake = this.live(mine, ConsentScope.INTAKE);
      const circulation = this.live(mine, ConsentScope.CIRCULATION);
      const hadCirculation = mine.some((c) => c.scope === ConsentScope.CIRCULATION);
      const needsReconfirmation = !circulation && hadCirculation;

      let reason: string | null = null;
      if (!intake) reason = 'No intake consent has been recorded for this profile.';
      else if (needsReconfirmation)
        reason = 'Circulation consent has lapsed. Confirm with the family before sharing again.';
      else if (!circulation)
        reason =
          'This profile has no circulation consent, so it cannot be shared outside the agency.';

      out.set(profileId, {
        intake,
        circulation,
        mayCirculate: Boolean(intake && circulation),
        needsReconfirmation,
        reason,
      });
    }
    return out;
  }

  /**
   * The single gate every circulation path calls. Throws with a message the
   * agent can act on rather than a bare 403.
   */
  async assertMayCirculate(profile: Profile): Promise<void> {
    // A profile its own owner controls needs no agency consent record: they are
    // sharing their own details.
    if (
      profile.claimStatus === ProfileClaimStatus.SELF ||
      profile.claimStatus === ProfileClaimStatus.CLAIMED
    ) {
      return;
    }
    const state = await this.stateFor(profile.id);
    if (!state.mayCirculate) {
      throw new ForbiddenException(
        state.reason ?? 'This profile cannot be circulated without recorded consent.',
      );
    }
  }

  /** Intake consent is required before an agency-built profile can be saved. */
  async assertMayHold(profileId: string): Promise<void> {
    const state = await this.stateFor(profileId);
    if (!state.intake) {
      throw new ForbiddenException('Record the family consent before using this profile.');
    }
  }

  async record(
    actor: AuthUser,
    profileId: string,
    dto: RecordConsentDto,
  ): Promise<ConsentState> {
    await this.stewardedProfile(actor, profileId);

    // Circulation consent expires so that "still happy for this to go around?"
    // is asked again periodically rather than assumed forever.
    const expiresAt =
      dto.scope === ConsentScope.CIRCULATION
        ? new Date(Date.now() + this.cfg.stewardship.circulationConsentValidityDays * 86_400_000)
        : null;

    await this.consents.save(
      this.consents.create({
        profileId,
        scope: dto.scope,
        method: dto.method,
        givenByRelation: dto.givenByRelation,
        givenByName: dto.givenByName,
        givenByPhone: dto.givenByPhone ?? null,
        givenAt: dto.givenAt,
        capturedByUserId: actor.userId,
        notes: dto.notes ?? null,
        expiresAt,
      }),
    );

    await this.audit.record({
      action:
        dto.scope === ConsentScope.CIRCULATION
          ? AuditAction.CONSENT_CIRCULATION_RECORDED
          : AuditAction.CONSENT_INTAKE_RECORDED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
      metadata: {
        method: dto.method,
        givenByRelation: dto.givenByRelation,
        givenAt: dto.givenAt,
      },
    });

    return this.stateFor(profileId);
  }

  async history(actor: AuthUser, profileId: string): Promise<ProfileConsent[]> {
    await this.stewardedProfile(actor, profileId);
    return this.consents.find({ where: { profileId }, order: { createdAt: 'DESC' } });
  }

  /**
   * Withdrawing consent. Revoking circulation also pulls the profile out of the
   * network pool immediately — leaving it listed would be exactly the thing the
   * family just asked us to stop.
   */
  async revoke(actor: AuthUser, consentId: string, dto: RevokeConsentDto): Promise<ConsentState> {
    const consent = await this.consents.findOne({ where: { id: consentId } });
    if (!consent) throw new NotFoundException('Consent record not found');

    const profile = await this.stewardedProfile(actor, consent.profileId);
    if (consent.revokedAt) return this.stateFor(profile.id);

    consent.revokedAt = new Date();
    consent.revokedReason = dto.reason ?? null;
    await this.consents.save(consent);

    if (consent.scope === ConsentScope.CIRCULATION) {
      profile.networkVisibility = NetworkVisibility.PRIVATE;
      profile.pooledAt = null;
      await this.profiles.save(profile);
    }

    await this.audit.record({
      action: AuditAction.CONSENT_REVOKED,
      actor,
      resourceType: 'profile',
      resourceId: profile.id,
      metadata: { scope: consent.scope, reason: dto.reason ?? null },
    });

    return this.stateFor(profile.id);
  }

  /** Bulk state, so a profile list can show a consent badge per row. */
  async statesFor(profileIds: string[]): Promise<Map<string, ConsentState>> {
    const out = new Map<string, ConsentState>();
    if (profileIds.length === 0) return out;

    const rows = await this.consents.find({ where: profileIds.map((id) => ({ profileId: id })) });
    for (const id of profileIds) {
      const mine = rows.filter((r) => r.profileId === id);
      const intake = this.live(mine, ConsentScope.INTAKE);
      const circulation = this.live(mine, ConsentScope.CIRCULATION);
      const hadCirculation = mine.some((c) => c.scope === ConsentScope.CIRCULATION);
      out.set(id, {
        intake,
        circulation,
        mayCirculate: Boolean(intake && circulation),
        needsReconfirmation: !circulation && hadCirculation,
        reason: null,
      });
    }
    return out;
  }

  /** Housekeeping hook: profiles whose circulation consent lapses shortly. */
  async expiringSoon(stewardUserId: string, withinDays = 14): Promise<ProfileConsent[]> {
    const cutoff = new Date(Date.now() + withinDays * 86_400_000);
    return this.consents
      .createQueryBuilder('c')
      .innerJoin(Profile, 'p', 'p.id = c."profileId"')
      .where('p."managedByUserId" = :steward', { steward: stewardUserId })
      .andWhere('c.scope = :scope', { scope: ConsentScope.CIRCULATION })
      .andWhere('c."revokedAt" IS NULL')
      .andWhere('c."expiresAt" IS NOT NULL')
      .andWhere('c."expiresAt" <= :cutoff', { cutoff })
      .andWhere('c."expiresAt" > NOW()')
      .orderBy('c."expiresAt"', 'ASC')
      .getMany();
  }

  /** Exposed for the profile list, where IsNull is needed on the join. */
  get repository(): Repository<ProfileConsent> {
    return this.consents;
  }

  /** Kept for readability at call sites that only care about live rows. */
  static readonly LIVE = { revokedAt: IsNull() };
}
