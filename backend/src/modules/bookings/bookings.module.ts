import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { Payment } from './entities/payment.entity';
import { WeddingEvent } from '../events/entities/event.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { Quotation } from './entities/quotation.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { AgentsModule } from '../agents/agents.module';
import { VerificationModule } from '../verification/verification.module';
import { MatchmakingModule } from '../matchmaking/matchmaking.module';
import { VendorsModule } from '../vendors/vendors.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ChatModule } from '../chat/chat.module';
import { BookingsService } from './bookings.service';
import { QuotationsService } from './quotations.service';
import { BookingChatService } from './booking-chat.service';
import { BookingsController } from './bookings.controller';
import { PaymentsController } from './payments.controller';
import {
  MockPaymentProvider,
  RazorpayPaymentProvider,
  paymentProviderFactory,
} from './payment.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      Payment,
      Quotation,
      Vendor,
      PlannerProfile,
      Profile,
      User,
      WeddingEvent,
      VendorService,
    ]),
    AgentsModule,
    VerificationModule,
    MatchmakingModule,
    forwardRef(() => VendorsModule),
    forwardRef(() => CatalogModule),
    // One-way: a booking knows about chat, chat knows nothing about bookings.
    // The rules for a booking's thread are made of payment state and job state,
    // which belong here.
    ChatModule,
  ],
  providers: [
    BookingsService,
    QuotationsService,
    BookingChatService,
    MockPaymentProvider,
    RazorpayPaymentProvider,
    paymentProviderFactory,
  ],
  controllers: [BookingsController, PaymentsController],
  exports: [BookingsService, QuotationsService, BookingChatService],
})
export class BookingsModule {}
