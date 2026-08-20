import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { Payment } from './entities/payment.entity';
import { Quotation } from './entities/quotation.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { AgentsModule } from '../agents/agents.module';
import { VerificationModule } from '../verification/verification.module';
import { MatchmakingModule } from '../matchmaking/matchmaking.module';
import { VendorsModule } from '../vendors/vendors.module';
import { BookingsService } from './bookings.service';
import { QuotationsService } from './quotations.service';
import { BookingsController } from './bookings.controller';
import { PaymentsController } from './payments.controller';
import {
  MockPaymentProvider,
  RazorpayPaymentProvider,
  paymentProviderFactory,
} from './payment.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, Payment, Quotation, Vendor, PlannerProfile, Profile, User]),
    AgentsModule,
    VerificationModule,
    MatchmakingModule,
    forwardRef(() => VendorsModule),
  ],
  providers: [
    BookingsService,
    QuotationsService,
    MockPaymentProvider,
    RazorpayPaymentProvider,
    paymentProviderFactory,
  ],
  controllers: [BookingsController, PaymentsController],
  exports: [BookingsService, QuotationsService],
})
export class BookingsModule {}
