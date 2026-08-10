import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Interest } from './entities/interest.entity';
import { Profile } from '../users/entities/profile.entity';
import { MatchmakingService } from './matchmaking.service';
import { MatchmakingController } from './matchmaking.controller';
import { CompatibilityEngine } from './compatibility.engine';

@Module({
  imports: [TypeOrmModule.forFeature([Interest, Profile])],
  providers: [MatchmakingService, CompatibilityEngine],
  controllers: [MatchmakingController],
  exports: [MatchmakingService],
})
export class MatchmakingModule {}
