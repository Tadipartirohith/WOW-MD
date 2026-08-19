import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vendor } from './entities/vendor.entity';
import { VendorReview } from './entities/vendor-review.entity';
import { VendorsService } from './vendors.service';
import { VendorsController } from './vendors.controller';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
  imports: [TypeOrmModule.forFeature([Vendor, VendorReview]), forwardRef(() => BookingsModule)],
  providers: [VendorsService],
  controllers: [VendorsController],
  exports: [VendorsService, TypeOrmModule],
})
export class VendorsModule {}
