import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceCategory } from './entities/service-category.entity';
import { ServiceDefinition } from './entities/service-definition.entity';
import { ServiceAttribute } from './entities/service-attribute.entity';
import { VendorService } from './entities/vendor-service.entity';
import { ServiceOffering } from './entities/service-offering.entity';
import { CatalogService } from './catalog.service';
import { VendorServicesService } from './vendor-services.service';
import { CatalogAdminController, CatalogController } from './catalog.controller';
import { ServiceBookingController, VendorServicesController } from './vendor-services.controller';
import { VendorsModule } from '../vendors/vendors.module';

/**
 * The service catalog.
 *
 * `forwardRef` on VendorsModule because the two genuinely need each other: the
 * catalog reads `vendors` to prove ownership, and the availability service
 * reads a vendor service to know how much capacity a published window has.
 * Neither is a layering mistake — they are two halves of what a business sells.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ServiceCategory,
      ServiceDefinition,
      ServiceAttribute,
      VendorService,
      ServiceOffering,
    ]),
    forwardRef(() => VendorsModule),
  ],
  providers: [CatalogService, VendorServicesService],
  controllers: [
    CatalogController,
    CatalogAdminController,
    VendorServicesController,
    ServiceBookingController,
  ],
  exports: [CatalogService, VendorServicesService, TypeOrmModule],
})
export class CatalogModule {}
