import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/booking.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateBookingDto) {
    return this.bookings.create(userId, dto);
  }

  @Get()
  list(@CurrentUser('userId') userId: string) {
    return this.bookings.listForUser(userId);
  }

  @Put(':id/pay')
  pay(@CurrentUser('userId') userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.pay(userId, id);
  }

  @Roles(UserRole.VENDOR, UserRole.ADMIN)
  @Put(':id/confirm')
  confirm(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.confirm(id);
  }

  @Put(':id/complete')
  complete(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.complete(id);
  }

  @Put(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.cancel(id);
  }
}
