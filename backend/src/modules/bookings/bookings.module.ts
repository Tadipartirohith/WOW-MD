import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from './entities/booking.entity';
import { Payment } from './entities/payment.entity';
import { WeddingEvent } from '../events/entities/event.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { Quotation } from './entities/quotation.entity';
import { BookingAddon } from './entities/booking-addon.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { PlannerReview } from '../wedding-planners/entities/planner-review.entity';
import { WeddingPlan } from '../planner/entities/wedding-plan.entity';
import { VerificationModule } from '../verification/verification.module';
import { MatchmakingModule } from '../matchmaking/matchmaking.module';
import { VendorsModule } from '../vendors/vendors.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ChatModule } from '../chat/chat.module';
import { BookingsService } from './bookings.service';
import { QuotationsService } from './quotations.service';
import { BookingAddonsService } from './booking-addons.service';
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
      BookingAddon,
      Vendor,
      PlannerProfile,
      // The buyer's own review of a booking, for both kinds of provider
      // (EZ1-I244). A planner's reviews are their own table.
      PlannerReview,
      Profile,
      User,
      WeddingEvent,
      VendorService,
      // Read/write, to auto-engage a planner on their client's plan when the
      // booking is confirmed (EZ1-I116).
      WeddingPlan,
    ]),
    // Mutual: settlement in verification calls back into this module to move
    // the escrow it decided (council review, 2026-09-10).
    forwardRef(() => VerificationModule),
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
    BookingAddonsService,
    BookingChatService,
    MockPaymentProvider,
    RazorpayPaymentProvider,
    paymentProviderFactory,
  ],
  controllers: [BookingsController, PaymentsController],
  exports: [BookingsService, QuotationsService, BookingChatService],
})
export class BookingsModule {}
