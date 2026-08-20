import {
  Body,
  Controller,
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
import { AvailabilityQueryDto, SetAvailabilityDto } from './dto/availability.dto';
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

  @ApiBearerAuth()
  @RequirePermissions(Permission.VENDOR_LISTING_MANAGE)
  @ApiOperation({
    summary: 'Open or block out a date',
    description: 'Capacity zero blocks the day. It cannot be set below what is already booked.',
  })
  @Put(':id/availability')
  setAvailability(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAvailabilityDto,
  ) {
    return this.availability.set(actor, id, dto);
  }

  @Public()
  @ApiOperation({ summary: 'A vendor calendar. Dates with no entry are open.' })
  @Get(':id/availability')
  listAvailability(@Param('id', ParseUUIDPipe) id: string, @Query() q: AvailabilityQueryDto) {
    return this.availability.list(id, q.from, q.to);
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
