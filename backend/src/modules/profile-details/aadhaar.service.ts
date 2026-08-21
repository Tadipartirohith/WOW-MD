import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { IdentityOtpSession } from './entities/identity-otp-session.entity';
import { Profile } from '../users/entities/profile.entity';
import { SendAadhaarOtpDto, VerifyAadhaarOtpDto } from './dto/aadhaar.dto';
import { AADHAAR_PROVIDER, AadhaarProvider } from './aadhaar.provider';
import { AppConfigService } from '../../config/app-config.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  hashGovernmentId,
  isValidAadhaar,
  lastFour,
  normaliseId,
} from '../../common/util/government-id';
import { GovernmentIdType, OtpVerificationStatus, UserRole } from '../../common/enums';

/** Long enough to read an SMS, short enough that a leaked code is stale. */
const OTP_TTL_SECONDS = 10 * 60;
const MAX_ATTEMPTS = 5;

/**
 * Aadhaar verification by OTP.
 *
 * Three rules shape this, and all three are about not holding what we do not
 * need. The Aadhaar number is validated, hashed under a server-side pepper and
 * discarded — never stored, never logged, never returned. The OTP is stored as
 * a hash for the same reason. And the last four digits are the only part of the
 * number that survives anywhere, because they are the only part a person needs
 * to recognise their own record.
 */
@Injectable()
export class AadhaarService {
  constructor(
    @InjectRepository(IdentityOtpSession)
    private readonly sessions: Repository<IdentityOtpSession>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly cfg: AppConfigService,
    private readonly audit: AuditService,
    @Inject(AADHAAR_PROVIDER) private readonly provider: AadhaarProvider,
  ) {}

  private get pepper(): string {
    return this.cfg.auth.jwtSecret;
  }

  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /**
   * Starts a verification. The number is checked, hashed for the duplicate
   * test, and then it exists only inside this call.
   */
  async sendOtp(
    actor: AuthUser,
    profileId: string,
    dto: SendAadhaarOtpDto,
  ): Promise<{ sessionId: string; expiresAt: Date; last4: string; devCode?: string }> {
    const profile = await this.editable(actor, profileId);

    if (profile.idVerifiedAt) {
      throw new BadRequestException('This profile is already verified');
    }
    if (!isValidAadhaar(dto.aadhaarNumber)) {
      throw new BadRequestException('That does not look like a valid Aadhaar number');
    }

    const hash = hashGovernmentId(GovernmentIdType.AADHAAR, dto.aadhaarNumber, this.pepper);
    const clash = await this.profiles.findOne({
      where: { governmentIdHash: hash, id: Not(profileId) },
    });
    if (clash) {
      // Deliberately does not say whose profile: that would leak another
      // agency's book, or another person's presence on the platform.
      throw new ConflictException(
        'That Aadhaar number is already registered against a profile on WOW.',
      );
    }

    const dispatch = await this.provider.sendOtp(normaliseId(dto.aadhaarNumber));
    const session = await this.sessions.save(
      this.sessions.create({
        profileId,
        requestedByUserId: actor.userId,
        providerRef: dispatch.providerRef,
        codeHash: this.hashCode(dispatch.devCode ?? ''),
        aadhaarLast4: lastFour(dto.aadhaarNumber),
        status: OtpVerificationStatus.SENT,
        attempts: 0,
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
      }),
    );

    // The hash goes on the profile now so the duplicate check holds even while
    // verification is still in flight — two people cannot both be mid-flow on
    // the same number.
    profile.governmentIdType = GovernmentIdType.AADHAAR;
    profile.governmentIdHash = hash;
    profile.governmentIdLast4 = session.aadhaarLast4;
    profile.idSubmittedAt = new Date();
    await this.profiles.save(profile);

    await this.audit.record({
      action: AuditAction.IDENTITY_OTP_SENT,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
      metadata: { last4: session.aadhaarLast4, providerRef: dispatch.providerRef },
    });

    return {
      sessionId: session.id,
      expiresAt: session.expiresAt,
      last4: session.aadhaarLast4,
      // Only ever present under the mock provider.
      ...(dispatch.devCode ? { devCode: dispatch.devCode } : {}),
    };
  }

  /** Confirms the code. Expiry and attempts are enforced here, not by the UI. */
  async verifyOtp(
    actor: AuthUser,
    profileId: string,
    dto: VerifyAadhaarOtpDto,
  ): Promise<{ verified: true; last4: string }> {
    const profile = await this.editable(actor, profileId);
    const session = await this.sessions.findOne({
      where: { id: dto.sessionId, profileId },
    });
    if (!session) throw new NotFoundException('That verification session does not exist');

    if (session.status === OtpVerificationStatus.VERIFIED) {
      return { verified: true, last4: session.aadhaarLast4 };
    }
    if (session.expiresAt.getTime() < Date.now()) {
      session.status = OtpVerificationStatus.EXPIRED;
      await this.sessions.save(session);
      throw new BadRequestException('That code has expired. Ask for a new one.');
    }
    if (session.attempts >= MAX_ATTEMPTS) {
      session.status = OtpVerificationStatus.FAILED;
      await this.sessions.save(session);
      throw new ForbiddenException('Too many attempts. Ask for a new code.');
    }

    session.attempts += 1;

    const providerAgrees = await this.provider.verifyOtp(session.providerRef ?? '', dto.code);
    const matches = providerAgrees && this.hashCode(dto.code) === session.codeHash;
    if (!matches) {
      await this.sessions.save(session);
      throw new BadRequestException(
        `That code is not right. ${MAX_ATTEMPTS - session.attempts} attempt(s) left.`,
      );
    }

    session.status = OtpVerificationStatus.VERIFIED;
    session.verifiedAt = new Date();
    await this.sessions.save(session);

    profile.idVerifiedAt = new Date();
    // Verified by the OTP itself rather than by a person, so no officer is
    // recorded — the audit event carries who ran it.
    profile.idVerifiedByUserId = null;
    await this.profiles.save(profile);

    await this.audit.record({
      action: AuditAction.IDENTITY_VERIFIED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
      metadata: { method: 'aadhaar_otp', last4: session.aadhaarLast4 },
    });

    return { verified: true, last4: session.aadhaarLast4 };
  }

  /** Where verification stands, for the profile page. */
  async status(actor: AuthUser, profileId: string) {
    const profile = await this.load(profileId);
    const mine = profile.userId === actor.userId || profile.managedByUserId === actor.userId;
    const staff = actor.role === UserRole.ADMIN || actor.role === UserRole.IN_PERSON;
    if (!mine && !staff) throw new ForbiddenException('That profile is not yours');

    const latest = await this.sessions.findOne({
      where: { profileId },
      order: { createdAt: 'DESC' },
    });

    return {
      profileId,
      idType: profile.governmentIdType,
      last4: profile.governmentIdLast4,
      submittedAt: profile.idSubmittedAt,
      verifiedAt: profile.idVerifiedAt,
      session: latest
        ? { id: latest.id, status: latest.status, expiresAt: latest.expiresAt }
        : null,
    };
  }

  private async load(profileId: string): Promise<Profile> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  private async editable(actor: AuthUser, profileId: string): Promise<Profile> {
    const profile = await this.load(profileId);
    const owns = profile.userId !== null && profile.userId === actor.userId;
    const stewards = profile.managedByUserId === actor.userId;
    if (!owns && !stewards && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('That profile is not yours');
    }
    return profile;
  }
}
