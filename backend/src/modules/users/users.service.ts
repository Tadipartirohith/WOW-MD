import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from './entities/profile.entity';
import { CreateProfileDto, UpdateProfileDto } from './dto/profile.dto';
import { ProfileClaimStatus } from '../../common/enums';

/**
 * The account holder's own profile.
 *
 * This used to keep a Redis copy of the profile row, and that cache is the
 * single most-reported defect on this platform: *values in the database not
 * appearing in the UI*.
 *
 * The mechanism was simple and completely invisible from any one file.
 * `getByUserId` cached the row for five minutes, and exactly one place in the
 * codebase — `upsert`, immediately below — knew to clear it. Thirteen other
 * files write to `profiles`: identity submission, Aadhaar verification, the
 * match lifecycle, agency stewardship, invitations, claim requests, consent,
 * sharing, officer allocation and the scheduled jobs. Every one of them left a
 * stale copy behind. So a person could verify their identity, watch the
 * identity endpoint report it confirmed, reload the page, and be told they were
 * unverified — for five minutes, with no way to tell why.
 *
 * The cache is gone rather than patched. What it saved was one indexed lookup
 * by `userId` on page load; what it cost was correctness across thirteen
 * writers, and any fix that leaves the cache in place is a fourteenth writer
 * away from the same bug. If profile reads ever genuinely become a bottleneck,
 * the version to write is one that cannot be forgotten — a TypeORM entity
 * subscriber on `Profile` — not another `del` at another call site.
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
  ) {}

  async upsert(userId: string, dto: CreateProfileDto | UpdateProfileDto): Promise<Profile> {
    let profile = await this.profiles.findOne({ where: { userId } });
    if (!profile) {
      profile = this.profiles.create({
        userId,
        ...dto,
        // Self-managed from the outset; stewardship is set only by the agent
        // paths in ManagedProfilesService.
        claimStatus: ProfileClaimStatus.SELF,
      } as Partial<Profile>);
    } else {
      Object.assign(profile, dto);
    }
    profile.profileCompleted = this.isComplete(profile);
    return this.profiles.save(profile);
  }

  async getByUserId(userId: string): Promise<Profile> {
    const profile = await this.profiles.findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('Profile not found');
    return profile;
  }

  private isComplete(p: Profile): boolean {
    return Boolean(p.displayName && p.gender && p.dateOfBirth && p.city);
  }
}
