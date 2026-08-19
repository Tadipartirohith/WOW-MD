import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfileConsent } from './entities/profile-consent.entity';
import { ProfileShare } from './entities/profile-share.entity';
import { ProposalNote } from './entities/proposal-note.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { ConsentService } from './consent.service';
import { SharingService } from './sharing.service';
import { ProposalsService } from './proposals.service';
import { AgentDirectoryService } from './agent-directory.service';
import { CirculationController } from './circulation.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProfileConsent,
      ProfileShare,
      ProposalNote,
      Profile,
      User,
      AgentProfile,
      Interest,
    ]),
  ],
  providers: [ConsentService, SharingService, ProposalsService, AgentDirectoryService],
  controllers: [CirculationController],
  exports: [ConsentService, SharingService, TypeOrmModule],
})
export class CirculationModule {}
