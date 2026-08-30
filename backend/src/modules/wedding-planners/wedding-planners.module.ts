import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationModule } from '../verification/verification.module';
import { PlannerProfile } from './entities/planner-profile.entity';
import { WeddingPlannersService } from './wedding-planners.service';
import { WeddingPlannersController } from './wedding-planners.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PlannerProfile]), VerificationModule],
  providers: [WeddingPlannersService],
  controllers: [WeddingPlannersController],
  exports: [WeddingPlannersService, TypeOrmModule],
})
export class WeddingPlannersModule {}
