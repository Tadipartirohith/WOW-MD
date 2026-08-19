import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from './entities/profile.entity';
import { CreateProfileDto, UpdateProfileDto } from './dto/profile.dto';
import { RedisService } from '../../platform/redis/redis.service';
import { ProfileClaimStatus } from '../../common/enums';

const profileCacheKey = (userId: string) => `profile:${userId}`;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly redis: RedisService,
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
    const saved = await this.profiles.save(profile);
    await this.redis.del(profileCacheKey(userId));
    return saved;
  }

  async getByUserId(userId: string): Promise<Profile> {
    const cached = await this.redis.get<Profile>(profileCacheKey(userId));
    if (cached) return cached;

    const profile = await this.profiles.findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('Profile not found');
    await this.redis.set(profileCacheKey(userId), profile);
    return profile;
  }

  private isComplete(p: Profile): boolean {
    return Boolean(p.displayName && p.gender && p.dateOfBirth && p.city);
  }
}
