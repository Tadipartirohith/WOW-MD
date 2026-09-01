import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WeddingPlan } from './entities/wedding-plan.entity';
import { PlanTask } from './entities/plan-task.entity';
import { User } from '../auth/entities/user.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { WeddingEvent } from '../events/entities/event.entity';
import { Guest } from '../events/entities/guest.entity';
import { EventInvite } from '../events/entities/event-invite.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { Profile } from '../users/entities/profile.entity';
import { AgentsModule } from '../agents/agents.module';
import { PlannerService } from './planner.service';
import { WeddingDashboardService } from './wedding-dashboard.service';
import { PlannerClientsService } from './planner-clients.service';
import { PlannerController } from './planner.controller';

@Module({
  imports: [
    // Booking and PlannerProfile are read directly (engagement must sit on a
    // confirmed booking); no need to pull in the whole BookingsModule.
    // The dashboard reads across modules and writes to none of them, so the
    // rows are read directly rather than by importing four whole modules and
    // acquiring their dependency graphs.
    TypeOrmModule.forFeature([
      WeddingPlan,
      PlanTask,
      User,
      Booking,
      PlannerProfile,
      WeddingEvent,
      Guest,
      EventInvite,
      Vendor,
      Profile,
    ]),
    AgentsModule,
  ],
  providers: [PlannerService, WeddingDashboardService, PlannerClientsService],
  controllers: [PlannerController],
  exports: [PlannerService, WeddingDashboardService, PlannerClientsService],
})
export class PlannerModule {}
