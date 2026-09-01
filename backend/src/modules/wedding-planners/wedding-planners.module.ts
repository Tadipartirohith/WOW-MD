import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationModule } from '../verification/verification.module';
import { PlannerProfile } from './entities/planner-profile.entity';
import { WeddingPlannersService } from './wedding-planners.service';
import { WeddingPlannersController } from './wedding-planners.controller';
import { PlannerAvailabilityController } from './planner-availability.controller';
import { VendorsModule } from '../vendors/vendors.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlannerProfile]),
    VerificationModule,
    // For AvailabilityService, which serves both kinds of provider now.
    forwardRef(() => VendorsModule),
  ],
  providers: [WeddingPlannersService],
  controllers: [WeddingPlannersController, PlannerAvailabilityController],
  exports: [WeddingPlannersService, TypeOrmModule],
})
export class WeddingPlannersModule {}
