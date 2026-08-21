import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ProfileClaimRequest } from './entities/profile-claim-request.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { NotificationType, ProfileClaimStatus, UserRole } from '../../common/enums';

/**
 * Connecting an agent-built profile to somebody who signed up on their own.
 *
 * The stranded case: an agent takes a family's details at the office and builds
 * a profile; the son signs up himself that evening. The invitation is then
 * refused as a duplicate email, and there was no way at all to join the two —
 * the agent's work sat on an unclaimed profile forever, and the client had a
 * blank account beside it.
 *
 * This is a request, never a transfer. An agent asserting "this profile is
 * yours" is a claim about a real person's identity, and the only party who can
 * settle it is that person. Approving hands over ownership and ends the agent's
 * write access, exactly as accepting an invitation does.
 */
@Injectable()
export class ProfileClaimsService {
  constructor(
    @InjectRepository(ProfileClaimRequest)
    private readonly requests: Repository<ProfileClaimRequest>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The agent asks. Matching is by the contact details already on the profile,
   * never by a free-text search — an agent should not be able to go hunting for
   * an account to attach their profile to.
   */
  async request(
    actor: AuthUser,
    profileId: string,
    message?: string,
  ): Promise<ProfileClaimRequest> {
    const profile = await this.profiles.findOne({ where: { id: profileId } });
    if (!profile) throw new NotFoundException('Profile not found');
    if (actor.role !== UserRole.ADMIN && profile.managedByUserId !== actor.userId) {
      throw new ForbiddenException('That profile is not one you manage');
    }
    if (profile.userId) {
      throw new ConflictException('That profile already has an owner');
    }

    const target = await this.findExistingAccount(profile);
    if (!target) {
      throw new BadRequestException(
        'No account matches this profile’s email or mobile number. Send an invitation instead.',
      );
    }

    const open = await this.requests.findOne({ where: { profileId, status: 'pending' } });
    if (open) {
      throw new ConflictException('A claim request for this profile is already waiting on a reply');
    }

    const created = await this.requests.save(
      this.requests.create({
        profileId,
        requestedByUserId: actor.userId,
        targetUserId: target.id,
        message: message ?? null,
        status: 'pending',
      }),
    );

    await this.notifications.create(target.id, NotificationType.TASK_REMINDER, {
      claimRequestId: created.id,
      profileId,
      title: `An agency has built a profile for you and would like to hand it over.`,
    });

    await this.audit.record({
      action: AuditAction.PROFILE_CLAIM_REQUESTED,
      actor,
      resourceType: 'profile',
      resourceId: profileId,
      metadata: { targetUserId: target.id },
    });

    return created;
  }

  /**
   * Whether an account already exists for the person this profile describes.
   *
   * Email first, then the mobile number — intake is phone-first, so a great
   * many profiles carry only a number, and that is exactly the case where the
   * subject is most likely to have signed up separately.
   */
  private async findExistingAccount(profile: Profile): Promise<User | null> {
    if (profile.contactEmail) {
      const byEmail = await this.users.findOne({ where: { email: profile.contactEmail } });
      if (byEmail) return byEmail;
    }
    if (profile.contactPhone) {
      const byPhone = await this.users.findOne({ where: { phone: profile.contactPhone } });
      if (byPhone) return byPhone;
    }
    return null;
  }

  /** What is waiting on this account to decide. */
  async listForTarget(userId: string) {
    const rows = await this.requests.find({
      where: { targetUserId: userId, status: 'pending' },
      order: { createdAt: 'DESC' },
    });
    if (rows.length === 0) return [];

    return Promise.all(
      rows.map(async (row) => {
        const [profile, agent] = await Promise.all([
          this.profiles.findOne({ where: { id: row.profileId } }),
          this.users.findOne({ where: { id: row.requestedByUserId } }),
        ]);
        const agentProfile = agent
          ? await this.profiles.findOne({ where: { userId: agent.id } })
          : null;

        return {
          id: row.id,
          message: row.message,
          createdAt: row.createdAt,
          requestedBy: agentProfile?.displayName ?? agent?.email ?? 'An agency',
          profile: profile
            ? {
                id: profile.id,
                displayName: profile.displayName,
                city: profile.city ?? null,
                photoCount: profile.photos?.length ?? 0,
              }
            : null,
        };
      }),
    );
  }

  /** What the agent can see of their own outstanding asks. */
  async listForRequester(actor: AuthUser) {
    return this.requests.find({
      where: { requestedByUserId: actor.userId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  /**
   * The subject accepts, and takes ownership.
   *
   * One transaction, because a half-applied transfer would leave a profile that
   * is claimed but ownerless — unreachable by the agent and invisible to the
   * person who just accepted it.
   */
  async approve(userId: string, requestId: string): Promise<{ profileId: string }> {
    const request = await this.loadPendingFor(userId, requestId);

    await this.dataSource.transaction(async (manager) => {
      const profileRepo = manager.getRepository(Profile);
      const requestRepo = manager.getRepository(ProfileClaimRequest);

      const profile = await profileRepo.findOne({ where: { id: request.profileId } });
      if (!profile) throw new NotFoundException('That profile no longer exists');
      if (profile.userId) throw new ConflictException('That profile already has an owner');

      // Signing up seeds a profile from the name on the registration form, so
      // very nearly everybody in this position already has one — and it is
      // almost always empty. Replacing an untouched stub is the whole point of
      // the feature; refusing on its existence would make the feature
      // unreachable for exactly the people it exists for.
      //
      // A profile somebody has actually filled in is a different matter. Two
      // real profiles is a merge, which is a harder problem than this, and
      // silently picking one would lose the other.
      const existingOwn = await profileRepo.findOne({ where: { userId } });
      if (existingOwn) {
        if (await this.isUntouched(manager, existingOwn)) {
          await manager.getRepository(Interest).delete([
            { fromProfileId: existingOwn.id },
            { toProfileId: existingOwn.id },
          ]);
          await profileRepo.delete({ id: existingOwn.id });
        } else {
          throw new ConflictException(
            'You have already filled in your own profile. Ask the agency to send you their ' +
              'details instead, so nothing you have written is lost.',
          );
        }
      }

      profile.userId = userId;
      profile.claimStatus = ProfileClaimStatus.CLAIMED;
      await profileRepo.save(profile);

      request.status = 'approved';
      request.respondedAt = new Date();
      await requestRepo.save(request);
    });

    await this.notifications.create(request.requestedByUserId, NotificationType.TASK_REMINDER, {
      profileId: request.profileId,
      title: 'Your claim request was accepted. The profile now belongs to its owner.',
    });

    await this.audit.record({
      action: AuditAction.PROFILE_CLAIMED,
      actor: { userId, role: UserRole.BRIDE },
      resourceType: 'profile',
      resourceId: request.profileId,
      metadata: { via: 'claim_request', requestId },
    });

    return { profileId: request.profileId };
  }

  /**
   * Is this profile just the stub registration created?
   *
   * The test is what somebody has *added* since: photographs, a biodata, an
   * interest sent or received, a completed flag. A stub carries a name and
   * nothing else, and deleting it to make room loses nothing at all.
   */
  private async isUntouched(manager: EntityManager, profile: Profile): Promise<boolean> {
    if (profile.profileCompleted) return false;
    if ((profile.photos?.length ?? 0) > 0) return false;
    if (profile.bio || profile.dateOfBirth || profile.city) return false;

    const [details, interests] = await Promise.all([
      manager.getRepository(ProfileDetails).count({ where: { profileId: profile.id } }),
      manager
        .getRepository(Interest)
        .count({ where: [{ fromProfileId: profile.id }, { toProfileId: profile.id }] }),
    ]);
    return details === 0 && interests === 0;
  }

  /** Declining is final, and says nothing back beyond the fact of it. */
  async decline(userId: string, requestId: string): Promise<{ success: true }> {
    const request = await this.loadPendingFor(userId, requestId);
    request.status = 'declined';
    request.respondedAt = new Date();
    await this.requests.save(request);

    await this.notifications.create(request.requestedByUserId, NotificationType.TASK_REMINDER, {
      profileId: request.profileId,
      title: 'Your claim request was declined.',
    });
    return { success: true };
  }

  private async loadPendingFor(userId: string, requestId: string): Promise<ProfileClaimRequest> {
    const request = await this.requests.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('That request no longer exists');
    if (request.targetUserId !== userId) {
      throw new ForbiddenException('That request is not addressed to you');
    }
    if (request.status !== 'pending') {
      throw new BadRequestException('That request has already been answered');
    }
    return request;
  }
}
