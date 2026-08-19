import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WeddingPlan } from './entities/wedding-plan.entity';
import { PlanTask } from './entities/plan-task.entity';
import { User } from '../auth/entities/user.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { AgentsModule } from '../agents/agents.module';
import { PlannerService } from './planner.service';
import { PlannerController } from './planner.controller';

@Module({
  imports: [
    // Booking and PlannerProfile are read directly (engagement must sit on a
    // confirmed booking); no need to pull in the whole BookingsModule.
    TypeOrmModule.forFeature([WeddingPlan, PlanTask, User, Booking, PlannerProfile]),
    AgentsModule,
  ],
  providers: [PlannerService],
  controllers: [PlannerController],
  exports: [PlannerService],
})
export class PlannerModule {}
