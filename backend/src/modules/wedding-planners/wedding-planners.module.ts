import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationModule } from '../verification/verification.module';
import { PlannerProfile } from './entities/planner-profile.entity';
import { PlannerReview } from './entities/planner-review.entity';
import { WeddingPlannersService } from './wedding-planners.service';
import { PlannerReviewsService } from './planner-reviews.service';
import { WeddingPlannersController } from './wedding-planners.controller';
import {
  AdminPlannerReviewsController,
  PlannerReviewsController,
} from './planner-reviews.controller';
import { PlannerAvailabilityController } from './planner-availability.controller';
import { VendorsModule } from '../vendors/vendors.module';
import { BookingsModule } from '../bookings/bookings.module';
import { Booking } from '../bookings/entities/booking.entity';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlannerProfile, PlannerReview, Booking, User, Profile]),
    VerificationModule,
    // For AvailabilityService, which serves both kinds of provider now.
    forwardRef(() => VendorsModule),
    // For the completed-booking check a review is gated on. Circular because
    // bookings read planner listings to name the provider on a row.
    forwardRef(() => BookingsModule),
  ],
  providers: [WeddingPlannersService, PlannerReviewsService],
  controllers: [
    WeddingPlannersController,
    PlannerReviewsController,
    AdminPlannerReviewsController,
    PlannerAvailabilityController,
  ],
  exports: [WeddingPlannersService, PlannerReviewsService, TypeOrmModule],
})
export class WeddingPlannersModule {}
