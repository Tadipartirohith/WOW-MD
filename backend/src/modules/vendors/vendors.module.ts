import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vendor } from './entities/vendor.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { ServiceOffering } from '../catalog/entities/service-offering.entity';
import { BusinessLifecycleService } from './business-lifecycle.service';
import { VerificationModule } from '../verification/verification.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VendorReview } from './entities/vendor-review.entity';
import { VendorAvailabilitySlot } from './entities/vendor-availability-slot.entity';
import { VendorsService } from './vendors.service';
import { AvailabilityService } from './availability.service';
import { VendorsController } from './vendors.controller';
import { BookingsModule } from '../bookings/bookings.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [
    forwardRef(() => VerificationModule),
    NotificationsModule,
    TypeOrmModule.forFeature([Vendor, VendorReview, VendorAvailabilitySlot, VendorService, ServiceOffering]),
    forwardRef(() => BookingsModule),
    forwardRef(() => CatalogModule),
  ],
  providers: [VendorsService, AvailabilityService, BusinessLifecycleService],
  controllers: [VendorsController],
  exports: [VendorsService, AvailabilityService, TypeOrmModule, BusinessLifecycleService],
})
export class VendorsModule {}
