import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsService } from './jobs.service';
import { AuthModule } from '../../modules/auth/auth.module';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { UsersModule } from '../../modules/users/users.module';
import { Payment } from '../../modules/bookings/entities/payment.entity';
import { Booking } from '../../modules/bookings/entities/booking.entity';
import { Profile } from '../../modules/users/entities/profile.entity';
import { ProfileConsent } from '../../modules/circulation/entities/profile-consent.entity';
import { Vendor } from '../../modules/vendors/entities/vendor.entity';

/**
 * Scheduled maintenance.
 *
 * Registered last in the app module so every service it leans on is already
 * constructed. The jobs themselves are in one service rather than scattered
 * across the modules they touch, so the answer to "what runs on a timer here"
 * is one file rather than a search.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([Payment, Booking, Profile, ProfileConsent, Vendor]),
    AuthModule,
    NotificationsModule,
    UsersModule,
  ],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
