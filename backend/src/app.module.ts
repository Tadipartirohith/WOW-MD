import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/app-config.service';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './platform/redis/redis.module';
import { Neo4jModule } from './platform/neo4j/neo4j.module';
import { KafkaModule } from './platform/messaging/kafka.module';
import { EventsModule } from './platform/events/events.module';
import { HealthModule } from './platform/health/health.module';
import { MailModule } from './platform/mail/mail.module';
import { SmsModule } from './platform/sms/sms.module';
import { PushModule } from './platform/push/push.module';
import { WhatsAppModule } from './platform/whatsapp/whatsapp.module';
import { JobsModule } from './platform/jobs/jobs.module';
import { AuditModule } from './platform/audit/audit.module';
import { ModerationModule } from './platform/moderation/moderation.module';
import { ThrottlingModule } from './platform/throttling/throttling.module';
import { RedisThrottlerStorage } from './platform/throttling/redis-throttler.storage';
import { AccountThrottlerGuard } from './platform/throttling/account-throttler.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { PasswordResetGuard } from './common/guards/password-reset.guard';

import { AuthModule } from './modules/auth/auth.module';
import { AgentsModule } from './modules/agents/agents.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { CirculationModule } from './modules/circulation/circulation.module';
import { VerificationModule } from './modules/verification/verification.module';
import { SupportModule } from './modules/support/support.module';
import { WeddingPlannersModule } from './modules/wedding-planners/wedding-planners.module';
import { UsersModule } from './modules/users/users.module';
import { ProfileDetailsModule } from './modules/profile-details/profile-details.module';
import { MatchmakingModule } from './modules/matchmaking/matchmaking.module';
import { ChatModule } from './modules/chat/chat.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { PlannerModule } from './modules/planner/planner.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { WeddingEventsModule } from './modules/events/events.module';
import { TravelModule } from './modules/travel/travel.module';
import { MediaModule } from './modules/media/media.module';
import { AdminModule } from './modules/admin/admin.module';
import { AiModule } from './modules/ai/ai.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => ({
        pinoHttp: {
          level: cfg.runtime.logLevel,
          transport: cfg.isProduction ? undefined : { target: 'pino-pretty' },
          redact: ['req.headers.authorization', 'req.body.password'],
        },
      }),
    }),
    // Counters live in Redis so the limit is the configured one no matter how
    // many replicas are running, and survives a restart.
    ThrottlingModule,
    ThrottlerModule.forRootAsync({
      imports: [ThrottlingModule],
      inject: [AppConfigService, RedisThrottlerStorage],
      useFactory: (cfg: AppConfigService, storage: RedisThrottlerStorage) => ({
        throttlers: [
          {
            ttl: cfg.security.rateLimitTtlSeconds * 1000,
            limit: cfg.security.rateLimitMax,
          },
        ],
        storage,
      }),
    }),
    DatabaseModule,
    RedisModule,
    Neo4jModule,
    KafkaModule,
    EventsModule,
    HealthModule,
    MailModule,
    SmsModule,
    PushModule,
    WhatsAppModule,
    JobsModule,
    AuditModule,
    ModerationModule,

    AuthModule,
    InvitationsModule,
    CirculationModule,
    VerificationModule,
    SupportModule,
    AgentsModule,
    WeddingPlannersModule,
    UsersModule,
    ProfileDetailsModule,
    MatchmakingModule,
    ChatModule,
    VendorsModule,
    CatalogModule,
    PlannerModule,
    NotificationsModule,
    BookingsModule,
    WeddingEventsModule,
    TravelModule,
    MediaModule,
    AdminModule,
    AiModule,
  ],
  providers: [
    // Rate limits by account when signed in, by IP otherwise.
    { provide: APP_GUARD, useClass: AccountThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Runs before the role and capability checks: an account still holding an
    // emailed temporary password gets no further than the reset screen.
    { provide: APP_GUARD, useClass: PasswordResetGuard },
    // Capability check runs last, after authentication and coarse role checks.
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
