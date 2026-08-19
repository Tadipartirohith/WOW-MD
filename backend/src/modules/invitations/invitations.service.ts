import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Invitation } from './entities/invitation.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../platform/mail/mail.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { expiresIn, generateToken, hashToken } from '../../common/util/tokens';
import {
  InvitationStatus,
  ProfileClaimStatus,
  UserRole,
} from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

/** What the public invitation-landing page is allowed to see. */
export interface InvitationPreview {
  displayName: string;
  email: string;
  invitedBy: string;
  city: string | null;
  photoCount: number;
  expiresAt: Date;
}

/**
 * Invitations turn a steward-built profile into a self-owned account.
 *
 * The steward never chooses the subject's password: they supply an email and a
 * mobile number, we email a single-use link, and the subject sets their own
 * credentials when they accept. That is what stops an agent from being able to
 * sign in as their own client.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @InjectRepository(Invitation) private readonly invitations: Repository<Invitation>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly cfg: AppConfigService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Sends (or re-sends) an invitation for a managed profile.
   * Any previously pending invitation for the profile is superseded, so only
   * the newest link ever works.
   */
  async invite(
    actor: AuthUser,
    profileId: string,
  ): Promise<{ status: InvitationStatus; expiresAt: Date; devToken?: string; devUrl?: string }> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');

    if (actor.role !== UserRole.ADMIN && profile.managedByUserId !== actor.userId) {
      throw new ForbiddenException('That profile is not one you manage');
    }
    if (profile.claimStatus === ProfileClaimStatus.CLAIMED) {
      throw new ConflictException('That profile has already been claimed by its owner');
    }
    if (!profile.contactEmail) {
      throw new BadRequestException('Add an email address to the profile before inviting');
    }

    // The subject may already have signed up on their own since the profile was
    // built. Refuse rather than silently creating a duplicate account.
    const existingUser = await this.users.findOne({ where: { email: profile.contactEmail } });
    if (existingUser) {
      throw new ConflictException(
        'An account already exists for that email address. Ask them to sign in and link the profile.',
      );
    }

    const prior = await this.invitations.find({
      where: { profileId, status: InvitationStatus.PENDING },
    });
    const resendCount = prior.reduce((max, p) => Math.max(max, p.resendCount), 0);
    if (resendCount >= this.cfg.stewardship.maxInvitationResends) {
      throw new BadRequestException(
        'This invitation has been re-sent too many times. Check the address with the client first.',
      );
    }
    for (const p of prior) {
      p.status = InvitationStatus.REVOKED;
      await this.invitations.save(p);
    }

    const { token, tokenHash } = generateToken();
    const expiry = expiresIn(this.cfg.auth.invitationTtlHours * 3600);
    await this.invitations.save(
      this.invitations.create({
        profileId,
        email: profile.contactEmail,
        phone: profile.contactPhone,
        tokenHash,
        status: InvitationStatus.PENDING,
        invitedByUserId: actor.userId,
        expiresAt: expiry,
        resendCount: resendCount + (prior.length ? 1 : 0),
      }),
    );

    profile.claimStatus = ProfileClaimStatus.INVITED;
    await this.profiles.save(profile);

    const steward = await this.users.findOne({ where: { id: actor.userId } });
    const stewardProfile = steward
      ? await this.profiles.findOne({ where: { userId: steward.id } })
      : null;

    await this.mail.sendProfileInvitation({
      to: profile.contactEmail,
      inviteeName: profile.displayName,
      stewardName: stewardProfile?.displayName ?? steward?.email ?? 'Your agent',
      token,
      expiresAt: expiry,
    });

    await this.audit.record({
      action: AuditAction.PROFILE_INVITED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
      metadata: { email: profile.contactEmail },
    });

    // In dev the 'log' mail provider does not actually deliver anything, so the
    // link would be unreachable. Hand it back on the response instead — but
    // ONLY in that mode: the token is enough to claim the account, so a real
    // deployment must never let the steward see it.
    const dev =
      this.cfg.mail.provider === 'log'
        ? { devToken: token, devUrl: `${this.cfg.mail.appBaseUrl}/invite/${token}` }
        : {};

    return { status: InvitationStatus.PENDING, expiresAt: expiry, ...dev };
  }

  /** Loads a pending, unexpired invitation by its plaintext token. */
  private async loadPending(token: string): Promise<Invitation> {
    const invitation = await this.invitations.findOne({
      where: { tokenHash: hashToken(token), status: InvitationStatus.PENDING },
    });
    if (!invitation) {
      throw new NotFoundException('That invitation link is not valid or has already been used');
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      invitation.status = InvitationStatus.EXPIRED;
      await this.invitations.save(invitation);
      throw new BadRequestException('That invitation has expired. Ask for a new one.');
    }
    return invitation;
  }

  /**
   * Public landing-page data. Returns only what the invitee needs to recognise
   * the invitation — never the whole profile, since anyone holding the link
   * could be the wrong person until they authenticate.
   */
  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.loadPending(token);
    const profile = await this.profiles.findOne({ where: { id: invitation.profileId } });
    if (!profile) throw new NotFoundException('That profile no longer exists');

    const steward = await this.users.findOne({ where: { id: invitation.invitedByUserId } });
    const stewardProfile = steward
      ? await this.profiles.findOne({ where: { userId: steward.id } })
      : null;

    return {
      displayName: profile.displayName,
      email: invitation.email,
      invitedBy: stewardProfile?.displayName ?? steward?.email ?? 'A WOW agent',
      city: profile.city ?? null,
      photoCount: profile.photos?.length ?? 0,
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * Accepts an invitation: creates the account, links it to the profile and
   * marks the profile claimed. Everything happens in one transaction so a
   * failure cannot leave an account without its profile.
   *
   * The subject's email is verified implicitly — they proved control of it by
   * following the link.
   */
  async accept(token: string, password: string): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const invitationRepo = manager.getRepository(Invitation);
      const profileRepo = manager.getRepository(Profile);
      const userRepo = manager.getRepository(User);

      const invitation = await invitationRepo.findOne({
        where: { tokenHash: hashToken(token), status: InvitationStatus.PENDING },
      });
      if (!invitation) {
        throw new NotFoundException('That invitation link is not valid or has already been used');
      }
      if (invitation.expiresAt.getTime() <= Date.now()) {
        invitation.status = InvitationStatus.EXPIRED;
        await invitationRepo.save(invitation);
        throw new BadRequestException('That invitation has expired. Ask for a new one.');
      }

      const profile = await profileRepo.findOne({ where: { id: invitation.profileId } });
      if (!profile) throw new NotFoundException('That profile no longer exists');
      if (profile.userId) throw new ConflictException('That profile already has an owner');

      const clash = await userRepo.findOne({ where: { email: invitation.email } });
      if (clash) throw new ConflictException('An account already exists for that email address');

      const passwordHash = await bcrypt.hash(password, this.cfg.auth.bcryptRounds);
      const user = await userRepo.save(
        userRepo.create({
          email: invitation.email,
          phone: invitation.phone,
          passwordHash,
          // The profile decides the persona; a steward builds bride/groom/family
          // profiles only, which is enforced when the profile is created.
          role: this.roleForProfile(profile),
          managedByAgentId: invitation.invitedByUserId,
          isActive: true,
          // Following the emailed link proves control of the address.
          isVerified: true,
          emailVerifiedAt: new Date(),
        }),
      );

      profile.userId = user.id;
      profile.claimStatus = ProfileClaimStatus.CLAIMED;
      await profileRepo.save(profile);

      invitation.status = InvitationStatus.ACCEPTED;
      invitation.acceptedAt = new Date();
      invitation.acceptedUserId = user.id;
      await invitationRepo.save(invitation);

      await this.audit.record(
        {
          action: AuditAction.PROFILE_CLAIMED,
          actor: { userId: user.id, role: user.role },
          resourceType: 'profile',
          resourceId: profile.id,
          metadata: { invitedByUserId: invitation.invitedByUserId },
        },
        manager,
      );

      return user;
    });
  }

  /**
   * A steward-built profile always describes an individual. The gender field is
   * only a hint, so default to FAMILY-free bride/groom and fall back to BRIDE.
   */
  private roleForProfile(profile: Profile): UserRole {
    const gender = (profile.gender ?? '').trim().toLowerCase();
    if (gender.startsWith('m')) return UserRole.GROOM;
    return UserRole.BRIDE;
  }

  async listForProfile(actor: AuthUser, profileId: string): Promise<Invitation[]> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');
    if (actor.role !== UserRole.ADMIN && profile.managedByUserId !== actor.userId) {
      throw new ForbiddenException('That profile is not one you manage');
    }
    return this.invitations.find({ where: { profileId }, order: { createdAt: 'DESC' } });
  }

  async revoke(actor: AuthUser, invitationId: string): Promise<{ success: true }> {
    const invitation = await this.invitations.findOne({ where: { id: invitationId } });
    if (!invitation) throw new NotFoundException('Invitation not found');

    const profile = await this.profiles.findOne({ where: { id: invitation.profileId } });
    if (actor.role !== UserRole.ADMIN && profile?.managedByUserId !== actor.userId) {
      throw new ForbiddenException('That invitation is not yours to revoke');
    }
    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new ConflictException('That invitation has already been accepted');
    }

    invitation.status = InvitationStatus.REVOKED;
    await this.invitations.save(invitation);

    if (profile && profile.claimStatus === ProfileClaimStatus.INVITED) {
      profile.claimStatus = ProfileClaimStatus.UNCLAIMED;
      await this.profiles.save(profile);
    }
    return { success: true };
  }
}
