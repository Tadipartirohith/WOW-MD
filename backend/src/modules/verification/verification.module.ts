import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationRequest } from './entities/verification-request.entity';
import { OfficerServiceArea } from './entities/officer-service-area.entity';
import { OfficerAvailability } from './entities/officer-availability.entity';
import { SupportCase } from './entities/support-case.entity';
import { User } from '../auth/entities/user.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { VendorAvailabilitySlot } from '../vendors/entities/vendor-availability-slot.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { Profile } from '../users/entities/profile.entity';
import { VerificationService } from './verification.service';
import { SupportCasesService } from './support-cases.service';
import { OfficersService } from './officers.service';
import { VerificationController } from './verification.controller';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { VendorsModule } from '../vendors/vendors.module';
import { CatalogModule } from '../catalog/catalog.module';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VerificationRequest,
      OfficerServiceArea,
      OfficerAvailability,
      SupportCase,
      User,
      AgentProfile,
      Vendor,
      VendorAvailabilitySlot,
      Payment,
      Booking,
      PlannerProfile,
      Profile,
    ]),
    UsersModule,
    NotificationsModule,
    // The lifecycle lives with the vendors module; the two reference each other
    // because a verification decision is what moves a business.
    forwardRef(() => VendorsModule),
    // So an officer reviewing a vendor can see the catalog & offerings that
    // business submitted, not just its base row (EZ1-I25).
    CatalogModule,
    /*
     * Settling a dispute moves escrow, and escrow is moved in exactly one
     * place -- BookingsService. Bookings already imports this module for
     * SupportCasesService, so the reference is mutual and both sides say so
     * (council review, 2026-09-10).
     */
    forwardRef(() => BookingsModule),
  ],
  providers: [VerificationService, SupportCasesService, OfficersService],
  controllers: [VerificationController],
  exports: [VerificationService, SupportCasesService, OfficersService, TypeOrmModule],
})
export class VerificationModule {}
