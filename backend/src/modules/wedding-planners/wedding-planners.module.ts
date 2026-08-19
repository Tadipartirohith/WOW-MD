import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlannerProfile } from './entities/planner-profile.entity';
import { WeddingPlannersService } from './wedding-planners.service';
import { WeddingPlannersController } from './wedding-planners.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PlannerProfile])],
  providers: [WeddingPlannersService],
  controllers: [WeddingPlannersController],
  exports: [WeddingPlannersService, TypeOrmModule],
})
export class WeddingPlannersModule {}
