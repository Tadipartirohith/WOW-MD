import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/app-config.service';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './platform/redis/redis.module';
import { Neo4jModule } from './platform/neo4j/neo4j.module';
import { KafkaModule } from './platform/messaging/kafka.module';
import { EventsModule } from './platform/events/events.module';
import { HealthModule } from './platform/health/health.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { MatchmakingModule } from './modules/matchmaking/matchmaking.module';
import { ChatModule } from './modules/chat/chat.module';
import { VendorsModule } from './modules/vendors/vendors.module';
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
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => [
        {
          ttl: cfg.security.rateLimitTtlSeconds * 1000,
          limit: cfg.security.rateLimitMax,
        },
      ],
    }),
    DatabaseModule,
    RedisModule,
    Neo4jModule,
    KafkaModule,
    EventsModule,
    HealthModule,

    AuthModule,
    UsersModule,
    MatchmakingModule,
    ChatModule,
    VendorsModule,
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
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
