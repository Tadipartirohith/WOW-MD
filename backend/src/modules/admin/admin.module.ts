import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Dispute } from './entities/dispute.entity';
import { Profile } from '../users/entities/profile.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { AgentCharge } from '../agents/entities/agent-charge.entity';
import { VerificationRequest } from '../verification/entities/verification-request.entity';
import { SupportCase } from '../verification/entities/support-case.entity';
import { AgentsModule } from '../agents/agents.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Vendor,
      PlannerProfile,
      Booking,
      Dispute,
      Profile,
      Interest,
      Payment,
      AgentCharge,
      VerificationRequest,
      SupportCase,
    ]),
    AgentsModule,
  ],
  providers: [AdminService],
  controllers: [AdminController],
  exports: [AdminService],
})
export class AdminModule {}
