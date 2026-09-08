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
import { ProfileDetailsModule } from '../profile-details/profile-details.module';
import { ChatModule } from '../chat/chat.module';

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
    ProfileDetailsModule,
    // Blocking and reporting on a proposal thread reuse the direct chat's block
    // and report infrastructure rather than inventing a parallel one (EZ1-I130).
    ChatModule,
  ],
  providers: [ConsentService, SharingService, ProposalsService, AgentDirectoryService],
  controllers: [CirculationController],
  exports: [ConsentService, SharingService, TypeOrmModule],
})
export class CirculationModule {}
