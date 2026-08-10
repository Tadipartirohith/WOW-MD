import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WeddingPlan } from './entities/wedding-plan.entity';
import { PlanTask } from './entities/plan-task.entity';
import { PlannerService } from './planner.service';
import { PlannerController } from './planner.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WeddingPlan, PlanTask])],
  providers: [PlannerService],
  controllers: [PlannerController],
  exports: [PlannerService],
})
export class PlannerModule {}
