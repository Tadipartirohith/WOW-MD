import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { Payment } from './entities/payment.entity';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import {
  MockPaymentProvider,
  RazorpayPaymentProvider,
  paymentProviderFactory,
} from './payment.provider';

@Module({
  imports: [TypeOrmModule.forFeature([Booking, Payment])],
  providers: [BookingsService, MockPaymentProvider, RazorpayPaymentProvider, paymentProviderFactory],
  controllers: [BookingsController],
  exports: [BookingsService],
})
export class BookingsModule {}
