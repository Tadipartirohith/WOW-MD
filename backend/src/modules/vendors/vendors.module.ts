import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vendor } from './entities/vendor.entity';
import { VendorReview } from './entities/vendor-review.entity';
import { VendorsService } from './vendors.service';
import { VendorsController } from './vendors.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Vendor, VendorReview])],
  providers: [VendorsService],
  controllers: [VendorsController],
  exports: [VendorsService],
})
export class VendorsModule {}
