import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { Interest } from '../matchmaking/entities/interest.entity';
import { AgentProfile } from './entities/agent-profile.entity';
import { AgentCharge } from './entities/agent-charge.entity';
import { AgentReview } from './entities/agent-review.entity';
import { InvitationsModule } from '../invitations/invitations.module';
import { CirculationModule } from '../circulation/circulation.module';
import { VerificationModule } from '../verification/verification.module';
import { AgentsService } from './agents.service';
import { AgencyService } from './agency.service';
import { ManagedProfilesService } from './managed-profiles.service';
import { AgentBillingService } from './agent-billing.service';
import { ProfileClaimsService } from './profile-claims.service';
import { AgentReviewsService } from './agent-reviews.service';
import { ProfileClaimRequest } from './entities/profile-claim-request.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  MockPaymentProvider,
  RazorpayPaymentProvider,
  paymentProviderFactory,
} from '../bookings/payment.provider';
import { AgentsController } from './agents.controller';
import { ClaimRequestsController } from './claim-requests.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Profile,
      Interest,
      AgentProfile,
      AgentCharge,
      AgentReview,
      ProfileClaimRequest,
    ]),
    InvitationsModule,
    NotificationsModule,
    CirculationModule,
    VerificationModule,
  ],
  providers: [
    AgentsService,
    AgencyService,
    ManagedProfilesService,
    AgentBillingService,
    ProfileClaimsService,
    AgentReviewsService,
    // The gateway adapters are stateless, so agency billing binds its own copy
    // rather than importing BookingsModule and creating a cycle between the
    // marketplace and the brokerage.
    MockPaymentProvider,
    RazorpayPaymentProvider,
    paymentProviderFactory,
  ],
  controllers: [AgentsController, ClaimRequestsController],
  exports: [
    AgentsService,
    AgencyService,
    ManagedProfilesService,
    AgentBillingService,
    ProfileClaimsService,
    TypeOrmModule,
  ],
})
export class AgentsModule {}
