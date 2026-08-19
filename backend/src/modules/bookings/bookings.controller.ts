import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { BookingSearchDto, CancelBookingDto, CreateBookingDto } from './dto/booking.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Permission } from '../../common/authz/permissions';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @RequirePermissions(Permission.BOOKING_CREATE)
  @ApiOperation({
    summary: 'Place a booking',
    description:
      'Individual users book for themselves. Agents may pass onBehalfOfUserId to book for a ' +
      'client on their own books. Vendors and planners cannot reach this route.',
  })
  @Post()
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateBookingDto) {
    return this.bookings.create(actor, dto);
  }

  @RequirePermissions(Permission.BOOKING_READ_OWN)
  @ApiOperation({ summary: 'Bookings you placed (agents: also your clients’)' })
  @Get()
  list(@CurrentUser() actor: AuthUser, @Query() q: BookingSearchDto) {
    return this.bookings.listForBuyer(actor, q);
  }

  @RequirePermissions(Permission.BOOKING_READ_INCOMING)
  @ApiOperation({ summary: 'Bookings made against your vendor/planner listings' })
  @Get('incoming')
  incoming(@CurrentUser() actor: AuthUser, @Query() q: BookingSearchDto) {
    return this.bookings.listIncoming(actor, q);
  }

  @RequirePermissions(Permission.BOOKING_PAY)
  @Put(':id/pay')
  pay(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.pay(actor, id);
  }

  @RequirePermissions(Permission.BOOKING_CONFIRM)
  @Put(':id/confirm')
  confirm(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.confirm(actor, id);
  }

  @RequirePermissions(Permission.BOOKING_COMPLETE)
  @Put(':id/complete')
  complete(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.complete(actor, id);
  }

  /**
   * Deliberately not permission-gated to one side: both buyer and provider may
   * cancel, and the service resolves which side the caller is on.
   */
  @Put(':id/cancel')
  cancel(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelBookingDto,
  ) {
    return this.bookings.cancel(actor, id, dto.reason);
  }
}
