import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VendorServicesService } from './vendor-services.service';
import { UpsertOfferingDto, UpsertVendorServiceDto } from './dto/catalog.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

/**
 * What one business sells.
 *
 * The write routes are the vendor's own; the two read routes are what a buyer
 * needs to see a listing and fill in a request, so they sit under
 * `BOOKING_CREATE` rather than the listing permission.
 */
@ApiTags('vendor-services')
@ApiBearerAuth()
@Controller('vendors/:vendorId/services')
export class VendorServicesController {
  constructor(private readonly services: VendorServicesService) {}

  @ApiOperation({
    summary: 'Everything this business sells',
    description:
      'Each service expanded with its catalog definition, the form its buyers will be asked, ' +
      'its prices, and whether it is bookable today — a service with no live price is a ' +
      'description with nothing to submit against. ' +
      'Readable by anyone signed in, because a buyer choosing a service and a vendor editing ' +
      'one are looking at the same rows; a caller who does not own the business sees only the ' +
      'live services and prices.',
  })
  @Get()
  async list(@CurrentUser() actor: AuthUser, @Param('vendorId', ParseUUIDPipe) vendorId: string) {
    const mine = await this.services.ownsVendor(actor, vendorId);
    return this.services.listForVendor(vendorId, !mine);
  }

  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @Post()
  add(
    @CurrentUser() actor: AuthUser,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Body() dto: UpsertVendorServiceDto,
  ) {
    return this.services.addService(actor, vendorId, dto);
  }

  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @Put(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertVendorServiceDto,
  ) {
    return this.services.updateService(actor, vendorId, id, dto);
  }

  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @Delete(':id')
  remove(
    @CurrentUser() actor: AuthUser,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.services.removeService(actor, vendorId, id);
  }

  // -------------------------------------------------------------- offerings

  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @Post(':id/offerings')
  addOffering(
    @CurrentUser() actor: AuthUser,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertOfferingDto,
  ) {
    return this.services.addOffering(actor, vendorId, id, dto);
  }

  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @Put(':id/offerings/:offeringId')
  updateOffering(
    @CurrentUser() actor: AuthUser,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('offeringId', ParseUUIDPipe) offeringId: string,
    @Body() dto: UpsertOfferingDto,
  ) {
    return this.services.updateOffering(actor, vendorId, id, offeringId, dto);
  }

  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @Delete(':id/offerings/:offeringId')
  removeOffering(
    @CurrentUser() actor: AuthUser,
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('offeringId', ParseUUIDPipe) offeringId: string,
  ) {
    return this.services.removeOffering(actor, vendorId, id, offeringId);
  }
}

/**
 * The buyer's view of a service.
 *
 * Separate from the controller above so the two permissions do not have to be
 * held together: a buyer reading a service to book it is not managing a
 * listing.
 */
@ApiTags('vendor-services')
@ApiBearerAuth()
@RequirePermissions(Permission.BOOKING_CREATE)
@Controller('services')
export class ServiceBookingController {
  constructor(private readonly services: VendorServicesService) {}

  @ApiOperation({
    summary: 'What to ask a buyer, and what they can choose from',
    description:
      'The dynamic booking form. Generated from the catalog definition the vendor listed under, ' +
      'which is what replaces a hand-written request form per vendor type.',
  })
  @Get(':id/booking-form')
  bookingForm(@Param('id', ParseUUIDPipe) id: string) {
    return this.services.bookingContext(id);
  }
}
