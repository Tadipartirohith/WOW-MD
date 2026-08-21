import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Interest } from './entities/interest.entity';
import { Profile } from '../users/entities/profile.entity';
import { ProfileDetails } from '../profile-details/entities/profile-details.entity';
import { User } from '../auth/entities/user.entity';
import { MatchmakingService } from './matchmaking.service';
import { MatchmakingController } from './matchmaking.controller';
import { InvitationsModule } from '../invitations/invitations.module';
import { CompatibilityEngine } from './compatibility.engine';
import { MatchLifecycleService } from './match-lifecycle.service';
import { VerificationModule } from '../verification/verification.module';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Interest, Profile, User, ProfileDetails]),
    VerificationModule,
    InvitationsModule,
    forwardRef(() => AgentsModule),
  ],
  providers: [MatchmakingService, CompatibilityEngine, MatchLifecycleService],
  controllers: [MatchmakingController],
  exports: [MatchmakingService, MatchLifecycleService, TypeOrmModule],
})
export class MatchmakingModule {}
