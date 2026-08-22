import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vendor } from './entities/vendor.entity';
import { VendorReview } from './entities/vendor-review.entity';
import { VendorAvailabilitySlot } from './entities/vendor-availability-slot.entity';
import { VendorsService } from './vendors.service';
import { AvailabilityService } from './availability.service';
import { VendorsController } from './vendors.controller';
import { BookingsModule } from '../bookings/bookings.module';
import { VerificationModule } from '../verification/verification.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Vendor, VendorReview, VendorAvailabilitySlot]),
    forwardRef(() => BookingsModule),
    forwardRef(() => CatalogModule),
    VerificationModule,
  ],
  providers: [VendorsService, AvailabilityService],
  controllers: [VendorsController],
  exports: [VendorsService, AvailabilityService, TypeOrmModule],
})
export class VendorsModule {}
