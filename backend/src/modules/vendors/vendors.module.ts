import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vendor } from './entities/vendor.entity';
import { VendorReview } from './entities/vendor-review.entity';
import { VendorAvailability } from './entities/vendor-availability.entity';
import { VendorsService } from './vendors.service';
import { AvailabilityService } from './availability.service';
import { VendorsController } from './vendors.controller';
import { BookingsModule } from '../bookings/bookings.module';
import { VerificationModule } from '../verification/verification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Vendor, VendorReview, VendorAvailability]),
    forwardRef(() => BookingsModule),
    VerificationModule,
  ],
  providers: [VendorsService, AvailabilityService],
  controllers: [VendorsController],
  exports: [VendorsService, AvailabilityService, TypeOrmModule],
})
export class VendorsModule {}
