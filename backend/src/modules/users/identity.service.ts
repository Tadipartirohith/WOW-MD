import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Profile } from './entities/profile.entity';
import { SubmitGovernmentIdDto } from './dto/identity.dto';
import { AppConfigService } from '../../config/app-config.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  hashGovernmentId,
  isValidGovernmentId,
  lastFour,
} from '../../common/util/government-id';
import { UserRole } from '../../common/enums';

export interface IdentityView {
  profileId: string;
  idType: string | null;
  last4: string | null;
  submittedAt: Date | null;
  verifiedAt: Date | null;
}

/**
 * Government ID on a profile: proof of who somebody is, and the one thing that
 * reliably catches the same person appearing twice.
 *
 * Duplicate profiles are the chronic problem in this market — the same biodata
 * circulating from two agencies, or one person quietly running two profiles
 * with different ages on them. Phone numbers move and names get spelled three
 * ways; an Aadhaar number does not. So the hash carries a unique index, and the
 * second profile to present the same document is refused.
 *
 * The number itself is never stored. See `common/util/government-id.ts`.
 */
@Injectable()
export class IdentityService {
  constructor(
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly cfg: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  private get pepper(): string {
    // Reuses the JWT secret rather than adding another one to rotate. Both are
    // server-side secrets of the same sensitivity, and one fewer key to manage
    // is one fewer key to leave at its default.
    return this.cfg.auth.jwtSecret;
  }

  async submit(
    actor: AuthUser,
    profileId: string,
    dto: SubmitGovernmentIdDto,
  ): Promise<IdentityView> {
    const profile = await this.load(actor, profileId);

    if (!isValidGovernmentId(dto.idType, dto.idNumber)) {
      throw new BadRequestException(`That does not look like a valid ${dto.idType} number`);
    }
    if (profile.idVerifiedAt) {
      throw new BadRequestException(
        'This profile has already been verified. Raise a case to have the document changed.',
      );
    }

    const hash = hashGovernmentId(dto.idType, dto.idNumber, this.pepper);
    // One identity record per profile, shared with the Biodata Aadhaar panel. A
    // document already on file — submitted here or verified there — cannot be
    // swapped for a different one from this section either; changing it is a
    // case, not a re-submission (EZ1-I42).
    if (profile.governmentIdHash && profile.governmentIdHash !== hash) {
      throw new BadRequestException(
        'A different identity document is already on this profile. Raise a case to change it.',
      );
    }
    const clash = await this.profiles.findOne({
      where: { governmentIdHash: hash, id: Not(profileId) },
    });
    if (clash) {
      // Deliberately does not say whose profile it is: that would leak another
      // agency's book, or another person's presence on the platform.
      throw new ConflictException(
        'That identity document is already registered against a profile on WOW.',
      );
    }

    profile.governmentIdType = dto.idType;
    profile.governmentIdHash = hash;
    profile.governmentIdLast4 = lastFour(dto.idNumber);
    profile.idSubmittedAt = new Date();
    const saved = await this.profiles.save(profile);

    await this.audit.record({
      action: AuditAction.IDENTITY_SUBMITTED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
      // The last four digits only — the audit log is not a back door to the
      // number the rest of this class goes out of its way not to keep.
      metadata: { idType: dto.idType, last4: saved.governmentIdLast4 },
    });
    return this.view(saved);
  }

  /**
   * A verification officer confirms the document against the person in front of
   * them. Only they can: this is the whole reason the In-Person role exists.
   */
  async markVerified(actor: AuthUser, profileId: string): Promise<IdentityView> {
    if (actor.role !== UserRole.IN_PERSON && actor.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only a verification officer can confirm an identity document');
    }

    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');
    if (!profile.governmentIdHash) {
      throw new BadRequestException('No identity document has been submitted for this profile');
    }

    profile.idVerifiedAt = new Date();
    profile.idVerifiedByUserId = actor.userId;
    const saved = await this.profiles.save(profile);

    await this.audit.record({
      action: AuditAction.IDENTITY_VERIFIED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
    });
    return this.view(saved);
  }

  async status(actor: AuthUser, profileId: string): Promise<IdentityView> {
    return this.view(await this.load(actor, profileId));
  }

  /** The owner, the steward who manages it, an officer, or an admin. */
  private async load(actor: AuthUser, profileId: string): Promise<Profile> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');

    const mine = profile.userId === actor.userId || profile.managedByUserId === actor.userId;
    const staff = actor.role === UserRole.ADMIN || actor.role === UserRole.IN_PERSON;
    if (!mine && !staff) throw new ForbiddenException('That profile is not yours');
    return profile;
  }

  private view(profile: Profile): IdentityView {
    return {
      profileId: profile.id,
      idType: profile.governmentIdType,
      last4: profile.governmentIdLast4,
      submittedAt: profile.idSubmittedAt,
      verifiedAt: profile.idVerifiedAt,
    };
  }
}
