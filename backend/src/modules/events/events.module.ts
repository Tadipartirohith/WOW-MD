import { Module } from '@nestjs/common';
import { WeddingPlan } from '../planner/entities/wedding-plan.entity';
import { PlanTask } from '../planner/entities/plan-task.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WeddingEvent } from './entities/event.entity';
import { Guest } from './entities/guest.entity';
import { EventInvite } from './entities/event-invite.entity';
import { Profile } from '../users/entities/profile.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WeddingEvent,
      Guest,
      EventInvite,
      Profile,
      Booking,
      Vendor,
      WeddingPlan,
      // The wedding plan's tasks appear on the shared event workspace (EZ1-I84);
      // read-only, so the rows are read directly rather than importing the
      // whole planner module.
      PlanTask,
    ]),
    // Syncing a shared event to the other party raises a notification (EZ1-I84).
    NotificationsModule,
  ],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class WeddingEventsModule {}
