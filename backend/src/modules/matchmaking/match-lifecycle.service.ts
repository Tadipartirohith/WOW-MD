import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Interest } from './entities/interest.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { MatchmakingService } from './matchmaking.service';
import { SupportCasesService } from '../verification/support-cases.service';
import { AgentBillingService } from '../agents/agent-billing.service';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../platform/mail/mail.service';
import { SmsService } from '../../platform/sms/sms.service';
import { InvitationsService } from '../invitations/invitations.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { generateTemporaryPassword } from '../../common/util/passwords';
import {
  CaseSubject,
  InterestStatus,
  MatchFixedState,
  OnboardingStage,
  ProfileClaimStatus,
  UserRole,
} from '../../common/enums';

export interface MatchFixedResult {
  interest: Interest;
  state: MatchFixedState;
  /** Accounts created by this confirmation, if it was the second one. */
  provisioned: { userId: string; email: string }[];
}

/**
 * Everything that happens to a match after the first interest is sent.
 *
 * The centrepiece is Match Fixed: both sides must confirm, and the second
 * confirmation is what provisions customer accounts, closes matchmaking and
 * unlocks vendor services. One side deciding is explicitly not enough — this
 * is the point where the platform starts creating real accounts for real
 * people, so it takes two.
 */
@Injectable()
export class MatchLifecycleService {
  private readonly logger = new Logger(MatchLifecycleService.name);

  constructor(
    @InjectRepository(Interest) private readonly interests: Repository<Interest>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly matchmaking: MatchmakingService,
    private readonly cases: SupportCasesService,
    private readonly billing: AgentBillingService,
    private readonly cfg: AppConfigService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly invitations: InvitationsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Loads the interest and works out which side (or sides) the caller controls.
   *
   * Both is a real answer, not an edge case: an agency matching two of its own
   * clients speaks for both families, and in this market that is one of the
   * commonest ways a match actually happens.
   */
  private async mySide(
    actor: AuthUser,
    interestId: string,
  ): Promise<{ interest: Interest; sides: ('from' | 'to')[]; profiles: Profile[] }> {
    const interest = await this.interests.findOne({ where: { id: interestId } });
    if (!interest) throw new NotFoundException('That match no longer exists');

    const profiles = await this.profiles.find({
      where: { id: In([interest.fromProfileId, interest.toProfileId]) },
    });
    const from = profiles.find((p) => p.id === interest.fromProfileId);
    const to = profiles.find((p) => p.id === interest.toProfileId);
    if (!from || !to) throw new NotFoundException('That match no longer exists');

    const controls = (p: Profile) =>
      (p.userId !== null && p.userId === actor.userId) || p.managedByUserId === actor.userId;

    const sides: ('from' | 'to')[] = [];
    if (controls(from)) sides.push('from');
    if (controls(to)) sides.push('to');
    // An admin acts for the platform, not for a family, so they get both sides
    // for the administrative actions and are refused the confirmation below.
    if (sides.length === 0 && actor.role === UserRole.ADMIN) sides.push('from', 'to');

    if (sides.length === 0) {
      throw new ForbiddenException('You are not on either side of this match');
    }
    return { interest, sides, profiles };
  }

  // ------------------------------------------------------- lifecycle actions

  /**
   * The sender takes an unanswered request back. Only valid while pending —
   * once answered there is a decision on the record, and withdrawing would
   * quietly erase it.
   */
  async withdraw(actor: AuthUser, interestId: string): Promise<Interest> {
    const { interest, sides } = await this.mySide(actor, interestId);
    if (!sides.includes('from')) {
      throw new ForbiddenException('Only the side that sent the interest can withdraw it');
    }
    if (interest.status !== InterestStatus.PENDING) {
      throw new BadRequestException('That interest has already been answered');
    }

    interest.status = InterestStatus.WITHDRAWN;
    interest.endedByUserId = actor.userId;
    return this.interests.save(interest);
  }

  /** Ends an accepted match. Either side may do it, and chat closes with it. */
  async unmatch(actor: AuthUser, interestId: string, reason?: string): Promise<Interest> {
    const { interest } = await this.mySide(actor, interestId);
    if (interest.status !== InterestStatus.ACCEPTED) {
      throw new BadRequestException('Only an accepted match can be unmatched');
    }
    if (interest.matchFixedState === MatchFixedState.CONFIRMED) {
      throw new BadRequestException(
        'This match has been fixed and accounts have been created. Raise a case instead.',
      );
    }

    interest.status = InterestStatus.UNMATCHED;
    interest.matchFixedState = MatchFixedState.NONE;
    interest.fixedConfirmedFromAt = null;
    interest.fixedConfirmedToAt = null;
    interest.endedByUserId = actor.userId;
    interest.endedReason = reason ?? null;
    const saved = await this.interests.save(interest);

    await this.audit.record({
      action: AuditAction.MATCH_UNMATCHED,
      actor,
      resourceType: 'interest',
      resourceId: interestId,
      metadata: { reason: reason ?? null },
    });
    return saved;
  }

  /**
   * Blocks the other side. Stronger than unmatching: the pair are excluded
   * from each other's recommendations permanently, which is why the record is
   * kept rather than deleted.
   */
  async block(actor: AuthUser, interestId: string, reason?: string): Promise<Interest> {
    const { interest } = await this.mySide(actor, interestId);

    interest.status = InterestStatus.BLOCKED;
    interest.matchFixedState = MatchFixedState.NONE;
    interest.endedByUserId = actor.userId;
    interest.endedReason = reason ?? null;
    const saved = await this.interests.save(interest);

    await this.audit.record({
      action: AuditAction.MATCH_BLOCKED,
      actor,
      resourceType: 'interest',
      resourceId: interestId,
      metadata: { reason: reason ?? null },
    });
    return saved;
  }

  /**
   * Raises a case against the match. Blocks as well, because someone reporting
   * a profile should not have to keep seeing it while the case is worked.
   */
  async report(actor: AuthUser, interestId: string, reason: string): Promise<Interest> {
    const { interest } = await this.mySide(actor, interestId);

    await this.cases.raise(actor, {
      subjectType: CaseSubject.MATCH,
      subjectId: interestId,
      title: 'Match reported',
      description: reason,
    });

    interest.status = InterestStatus.BLOCKED;
    interest.endedByUserId = actor.userId;
    interest.endedReason = reason;
    const saved = await this.interests.save(interest);

    await this.audit.record({
      action: AuditAction.MATCH_REPORTED,
      actor,
      resourceType: 'interest',
      resourceId: interestId,
    });
    return saved;
  }

  // ------------------------------------------------------------ match fixed

  /**
   * Confirms this side's intention to fix the match.
   *
   * The first call moves the match to PENDING_CONFIRMATION. The second — from
   * the other side — confirms it, and everything downstream happens then:
   * accounts are provisioned, matchmaking closes, services unlock.
   */
  async confirmMatchFixed(
    actor: AuthUser,
    interestId: string,
    requestedSide?: 'from' | 'to',
  ): Promise<MatchFixedResult> {
    const { interest, sides } = await this.mySide(actor, interestId);
    if (interest.status !== InterestStatus.ACCEPTED) {
      throw new BadRequestException('Only an accepted match can be fixed');
    }
    if (interest.matchFixedState === MatchFixedState.CONFIRMED) {
      throw new BadRequestException('This match is already fixed');
    }

    const confirmed = (s: 'from' | 'to') =>
      s === 'from' ? Boolean(interest.fixedConfirmedFromAt) : Boolean(interest.fixedConfirmedToAt);

    // Default to whichever side the caller controls that has not confirmed yet.
    // For an ordinary person that is simply their own side; for an agency that
    // holds both, it means two calls record two distinct confirmations rather
    // than the second one bouncing off the first.
    const side = requestedSide ?? sides.find((s) => !confirmed(s)) ?? sides[0];
    if (!sides.includes(side)) {
      throw new ForbiddenException('You do not act for that side of this match');
    }
    if (confirmed(side)) {
      throw new BadRequestException('You have already confirmed. Waiting on the other side.');
    }

    const now = new Date();
    if (side === 'from') interest.fixedConfirmedFromAt = now;
    else interest.fixedConfirmedToAt = now;

    const bothConfirmed = Boolean(interest.fixedConfirmedFromAt && interest.fixedConfirmedToAt);
    interest.matchFixedState = bothConfirmed
      ? MatchFixedState.CONFIRMED
      : MatchFixedState.PENDING_CONFIRMATION;
    if (bothConfirmed) interest.matchFixedAt = now;

    await this.interests.save(interest);

    await this.audit.record({
      action: bothConfirmed
        ? AuditAction.MATCH_FIXED_CONFIRMED
        : AuditAction.MATCH_FIXED_PROPOSED,
      actor,
      resourceType: 'interest',
      resourceId: interestId,
      metadata: { side },
    });

    if (!bothConfirmed) {
      return { interest, state: interest.matchFixedState, provisioned: [] };
    }

    const provisioned = await this.onMatchFixed(interest);
    await this.outbox.record({
      eventType: 'match.fixed',
      aggregateType: 'interest',
      payload: {
        interestId,
        fromProfileId: interest.fromProfileId,
        toProfileId: interest.toProfileId,
      },
    });

    return { interest, state: MatchFixedState.CONFIRMED, provisioned };
  }

  /**
   * Everything the second confirmation triggers.
   *
   * Both sides are handled the same way regardless of how the profile got
   * here: a profile an agent built with no account behind it gets one created;
   * a profile whose owner is already signed up simply moves on to the next
   * onboarding stage.
   */
  private async onMatchFixed(interest: Interest): Promise<{ userId: string; email: string }[]> {
    const profiles = await this.profiles.find({
      where: { id: In([interest.fromProfileId, interest.toProfileId]) },
    });

    const provisioned: { userId: string; email: string }[] = [];
    for (const profile of profiles) {
      // The agency's success fee falls due here — this is the outcome it was
      // engaged for — and everything already held for this profile is released
      // with it.
      await this.billing.raiseSettlementFee(profile, interest.id);
      await this.billing.releaseForFixedMatch(profile.id, interest.id);

      if (profile.userId) {
        // Already has an account: close matchmaking, unlock services.
        await this.users.update(profile.userId, {
          onboardingStage: OnboardingStage.MATCH_FIXED,
          matchInterestId: interest.id,
        });
        continue;
      }
      const created = await this.provisionCustomer(profile, interest.id);
      if (created) provisioned.push(created);
    }
    return provisioned;
  }

  /**
   * Creates the account for a profile that never had one, and sends the
   * temporary password.
   *
   * `mustResetPassword` is the safety catch: until the person changes it, the
   * temporary credential can do nothing except change itself.
   */
  private async provisionCustomer(
    profile: Profile,
    interestId: string,
  ): Promise<{ userId: string; email: string } | null> {
    const email = profile.contactEmail;
    if (!email) {
      // A phone-only walk-in. There is no address to send a temporary password
      // to, and inventing one would be worse than useless — so they get an SMS
      // invitation instead, and supply their own address when they claim the
      // account. That is the same route a steward-built profile takes, and it
      // ends with the person choosing their own password rather than being
      // handed one.
      if (profile.contactPhone && profile.managedByUserId) {
        await this.invitations
          .invite(
            { userId: profile.managedByUserId, role: UserRole.AGENT } as AuthUser,
            profile.id,
          )
          .catch((err) => {
            // The match is fixed either way. A failed invitation is resendable
            // and must not roll back the confirmation that triggered it.
            this.logger.warn(
              `Could not invite phone-only profile ${profile.id}: ${(err as Error).message}`,
            );
          });
      }
      return null;
    }

    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      await this.users.update(existing.id, {
        onboardingStage: OnboardingStage.MATCH_FIXED,
        matchInterestId: interestId,
      });
      if (!profile.userId) {
        profile.userId = existing.id;
        profile.claimStatus = ProfileClaimStatus.CLAIMED;
        await this.profiles.save(profile);
      }
      return null;
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, this.cfg.auth.bcryptRounds);

    const created = await this.dataSource.transaction(async (manager) => {
      const userRepo = manager.getRepository(User);
      const profileRepo = manager.getRepository(Profile);

      const user = await userRepo.save(
        userRepo.create({
          email,
          phone: profile.contactPhone,
          passwordHash,
          role: this.roleForProfile(profile),
          managedByAgentId: profile.managedByUserId,
          isActive: true,
          // The address is not proven yet; following the credential email is
          // what proves it, so verification stays false until they act.
          isVerified: false,
          mustResetPassword: true,
          isProvisioned: true,
          onboardingStage: OnboardingStage.MATCH_FIXED,
          matchInterestId: interestId,
        }),
      );

      profile.userId = user.id;
      profile.claimStatus = ProfileClaimStatus.CLAIMED;
      await profileRepo.save(profile);

      return user;
    });

    await this.mail.sendProvisionedCredentials({
      to: email,
      name: profile.displayName,
      temporaryPassword,
    });

    // Also by SMS where we have a number. An emailed password that lands in a
    // spam folder is a client who cannot sign in and an agent who has to be
    // rung up about it.
    if (profile.contactPhone) {
      await this.sms.sendProvisionedCredentials({
        to: profile.contactPhone,
        temporaryPassword,
      });
    }

    await this.audit.record({
      action: AuditAction.CUSTOMER_PROVISIONED,
      resourceType: 'user',
      resourceId: created.id,
      metadata: { profileId: profile.id, interestId },
    });

    return { userId: created.id, email };
  }

  private roleForProfile(profile: Profile): UserRole {
    const gender = (profile.gender ?? '').trim().toLowerCase();
    return gender.startsWith('m') ? UserRole.GROOM : UserRole.BRIDE;
  }

  /** The fixed match for a profile, for the dashboard. */
  async fixedMatchFor(profileId: string): Promise<Interest | null> {
    return this.interests.findOne({
      where: [
        { fromProfileId: profileId, matchFixedState: MatchFixedState.CONFIRMED },
        { toProfileId: profileId, matchFixedState: MatchFixedState.CONFIRMED },
      ],
    });
  }

  /**
   * Where a profile stands, for the dashboard: what stage of onboarding it is
   * in, whether a Match Fixed is waiting on the other side, and who the fixed
   * match is with.
   */
  async status(
    actor: AuthUser,
    profileId?: string,
  ): Promise<{
    profileId: string;
    profileCompleted: boolean;
    stage: OnboardingStage;
    matchFixedState: MatchFixedState;
    awaitingOtherSide: boolean;
    interestId: string | null;
    counterpartProfileId: string | null;
    servicesUnlocked: boolean;
  }> {
    const me = await this.matchmaking.resolveSubject(actor, profileId);

    const fixed = await this.fixedMatchFor(me.id);
    const pending = fixed
      ? null
      : await this.interests.findOne({
          where: [
            { fromProfileId: me.id, matchFixedState: MatchFixedState.PENDING_CONFIRMATION },
            { toProfileId: me.id, matchFixedState: MatchFixedState.PENDING_CONFIRMATION },
          ],
        });
    const current = fixed ?? pending;

    const stage = fixed
      ? OnboardingStage.MATCH_FIXED
      : me.profileCompleted
        ? OnboardingStage.MATCHMAKING_ACTIVE
        : OnboardingStage.PROFILE_INCOMPLETE;

    // "Waiting on them" means this side has confirmed and the other has not.
    let awaitingOtherSide = false;
    if (pending) {
      const mineIsFrom = pending.fromProfileId === me.id;
      awaitingOtherSide = mineIsFrom
        ? Boolean(pending.fixedConfirmedFromAt)
        : Boolean(pending.fixedConfirmedToAt);
    }

    return {
      profileId: me.id,
      profileCompleted: me.profileCompleted,
      stage,
      matchFixedState: current?.matchFixedState ?? MatchFixedState.NONE,
      awaitingOtherSide,
      interestId: current?.id ?? null,
      counterpartProfileId: current
        ? current.fromProfileId === me.id
          ? current.toProfileId
          : current.fromProfileId
        : null,
      servicesUnlocked: Boolean(fixed),
    };
  }

  /** Profile ids this profile has blocked or been blocked by. */
  async blockedCounterparts(profileId: string): Promise<string[]> {
    const rows = await this.interests.find({
      where: [
        { fromProfileId: profileId, status: InterestStatus.BLOCKED },
        { toProfileId: profileId, status: InterestStatus.BLOCKED },
      ],
    });
    return rows.map((r) => (r.fromProfileId === profileId ? r.toProfileId : r.fromProfileId));
  }
}
