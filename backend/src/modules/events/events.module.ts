import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WeddingEvent } from './entities/event.entity';
import { Guest } from './entities/guest.entity';
import { EventInvite } from './entities/event-invite.entity';
import { Profile } from '../users/entities/profile.entity';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WeddingEvent, Guest, EventInvite, Profile])],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class WeddingEventsModule {}
