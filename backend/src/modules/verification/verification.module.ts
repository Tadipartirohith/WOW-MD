import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationRequest } from './entities/verification-request.entity';
import { SupportCase } from './entities/support-case.entity';
import { User } from '../auth/entities/user.entity';
import { AgentProfile } from '../agents/entities/agent-profile.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { Profile } from '../users/entities/profile.entity';
import { VerificationService } from './verification.service';
import { SupportCasesService } from './support-cases.service';
import { OfficersService } from './officers.service';
import { VerificationController } from './verification.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VerificationRequest,
      SupportCase,
      User,
      AgentProfile,
      Vendor,
      Payment,
      Booking,
      PlannerProfile,
      Profile,
    ]),
    UsersModule,
  ],
  providers: [VerificationService, SupportCasesService, OfficersService],
  controllers: [VerificationController],
  exports: [VerificationService, SupportCasesService, OfficersService, TypeOrmModule],
})
export class VerificationModule {}
