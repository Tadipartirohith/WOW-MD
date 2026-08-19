import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { Payment } from './entities/payment.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { AgentsModule } from '../agents/agents.module';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { PaymentsController } from './payments.controller';
import {
  MockPaymentProvider,
  RazorpayPaymentProvider,
  paymentProviderFactory,
} from './payment.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Payment, Vendor, PlannerProfile]),
    AgentsModule,
  ],
  providers: [BookingsService, MockPaymentProvider, RazorpayPaymentProvider, paymentProviderFactory],
  controllers: [BookingsController, PaymentsController],
  exports: [BookingsService],
})
export class BookingsModule {}
