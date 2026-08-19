import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Interest } from './entities/interest.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { AgentsModule } from '../agents/agents.module';
import { MatchmakingService } from './matchmaking.service';
import { MatchmakingController } from './matchmaking.controller';
import { CompatibilityEngine } from './compatibility.engine';

@Module({
  imports: [TypeOrmModule.forFeature([Interest, Profile, User]), AgentsModule],
  providers: [MatchmakingService, CompatibilityEngine],
  controllers: [MatchmakingController],
  exports: [MatchmakingService, TypeOrmModule],
})
export class MatchmakingModule {}
