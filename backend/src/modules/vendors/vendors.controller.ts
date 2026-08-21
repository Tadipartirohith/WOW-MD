import {
  Body,
  Controller,
  Delete,
  HttpCode,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VendorsService } from './vendors.service';
import { AvailabilityService } from './availability.service';
import { BookingsService } from '../bookings/bookings.service';
import {
  CreateReviewDto,
  CreateVendorDto,
  UpdateVendorDto,
  VendorSearchDto,
} from './dto/vendor.dto';
import {
  AvailabilityQueryDto,
  BlockSlotDto,
  CreateSlotDto,
  UpdateSlotDto,
} from './dto/availability.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';
import { ProviderType, UserRole } from '../../common/enums';

@ApiTags('vendors')
@Controller('vendors')
export class VendorsController {
  constructor(
    private readonly vendors: VendorsService,
    private readonly availability: AvailabilityService,
    private readonly bookings: BookingsService,
  ) {}

  // ------------------------------------------------------------- calendar
  //
  // Availability runs on a rolling three-month window computed from today, so
  // a vendor never has to open a new quarter by hand.

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({ summary: 'Publish a bookable time slot' })
  @Post(':id/availability/slots')
  createSlot(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSlotDto,
  ) {
    return this.availability.create(actor, id, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({
    summary: 'Amend a slot',
    description: 'Times are fixed once anyone has requested it; capacity can still rise.',
  })
  @Put(':id/availability/slots/:slotId')
  updateSlot(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: UpdateSlotDto,
  ) {
    return this.availability.update(actor, id, slotId, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({
    summary: 'Delete a slot',
    description: 'Only an untouched one. Anything requested or booked is history — block it instead.',
  })
  @Delete(':id/availability/slots/:slotId')
  deleteSlot(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
  ) {
    return this.availability.remove(actor, id, slotId);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({ summary: 'Make a slot unavailable without losing it' })
  @HttpCode(200)
  @Post(':id/availability/slots/:slotId/block')
  blockSlot(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() dto: BlockSlotDto,
  ) {
    return this.availability.block(actor, id, slotId, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @HttpCode(200)
  @Post(':id/availability/slots/:slotId/unblock')
  unblockSlot(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
  ) {
    return this.availability.unblock(actor, id, slotId);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({ summary: 'Every slot in the window, whatever its status' })
  @Get(':id/availability/slots')
  listSlots(@Param('id', ParseUUIDPipe) id: string, @Query() q: AvailabilityQueryDto) {
    return this.availability.list(id, q.from, q.to);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({ summary: 'Counters for the availability dashboard' })
  @Get(':id/availability/summary')
  availabilitySummary(@Param('id', ParseUUIDPipe) id: string, @Query() q: AvailabilityQueryDto) {
    return this.availability.summary(id, q.from, q.to);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({ summary: 'Per-date rollup, for painting the calendar' })
  @Get(':id/availability/calendar')
  availabilityCalendar(@Param('id', ParseUUIDPipe) id: string, @Query() q: AvailabilityQueryDto) {
    return this.availability.calendar(id, q.from, q.to);
  }

  @Public()
  @ApiOperation({
    summary: 'Slots a buyer can actually book',
    description: 'Blocked, pending and booked windows are absent rather than shown greyed out.',
  })
  @Get(':id/availability')
  bookableSlots(@Param('id', ParseUUIDPipe) id: string, @Query() q: AvailabilityQueryDto) {
    return this.availability.listBookable(id, q.from, q.to);
  }

  @Public()
  @ApiOperation({ summary: 'The rolling window the calendar runs on' })
  @Get('availability/window')
  availabilityWindow() {
    return this.availability.window();
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateVendorDto) {
    return this.vendors.create(userId, dto);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({ summary: 'Your own vendor listings' })
  @Get('me')
  listOwn(@CurrentUser('userId') userId: string) {
    return this.vendors.listOwn(userId);
  }

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @Put(':id')
  update(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVendorDto,
  ) {
    return this.vendors.update(userId, id, dto);
  }

  @Public()
  @Get('search')
  search(@Query() q: VendorSearchDto) {
    return this.vendors.search(q);
  }

  @Public()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.vendors.findOne(id);
  }

  /**
   * Reviews are gated on a completed booking so the rating signal reflects real
   * transactions. Agents review on behalf of the client whose booking it was,
   * which is why the check runs against the agent's own completed bookings too.
   */
  @ApiBearerAuth()
  @RequirePermissions(Permission.REVIEW_WRITE)
  @Post(':id/reviews')
  async review(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReviewDto,
  ) {
    if (actor.role !== UserRole.ADMIN) {
      const eligible = await this.bookings.hasCompletedBookingWith(
        actor.userId,
        ProviderType.VENDOR,
        id,
      );
      if (!eligible) {
        throw new ForbiddenException(
          'You can only review a vendor after a booking with them is completed',
        );
      }
    }
    return this.vendors.addReview(id, actor.userId, dto);
  }
}
