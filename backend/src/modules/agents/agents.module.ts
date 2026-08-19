import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { AgentProfile } from './entities/agent-profile.entity';
import { InvitationsModule } from '../invitations/invitations.module';
import { AgentsService } from './agents.service';
import { AgencyService } from './agency.service';
import { ManagedProfilesService } from './managed-profiles.service';
import { AgentsController } from './agents.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, Profile, AgentProfile]), InvitationsModule],
  providers: [AgentsService, AgencyService, ManagedProfilesService],
  controllers: [AgentsController],
  exports: [AgentsService, AgencyService, ManagedProfilesService, TypeOrmModule],
})
export class AgentsModule {}
