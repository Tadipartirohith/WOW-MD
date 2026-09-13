import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import express from 'express';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RedisIoAdapter } from './platform/websocket/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // The payment webhook verifies an HMAC over the EXACT bytes received, so
    // the raw body has to survive JSON parsing.
    rawBody: true,
  });
  const cfg = app.get(AppConfigService);

  app.setGlobalPrefix(cfg.runtime.apiPrefix);
  app.use(helmet());
  // Refresh tokens ride in an httpOnly cookie, so the parser is required.
  app.use(cookieParser());
  // Behind nginx / an ELB, so rate limiting and audit logs record the real
  // client address rather than the proxy's.
  app.set('trust proxy', 1);
  app.enableCors({ origin: cfg.runtime.corsOrigins, credentials: true });

  // Uploaded bytes, for the mock storage. The JSON parser ignores an
  // image/jpeg body, so without this the PUT arrives with nothing in it — and
  // the raw-body option only captures what a parser has already handled.
  app.use(
    `/${cfg.runtime.apiPrefix}/mock-storage`,
    express.raw({ type: () => true, limit: cfg.media.maxFileSizeBytes }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true, // reject unexpected fields rather than stripping
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  // Wire Socket.io to Redis so real-time works across replicas.
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  if (cfg.runtime.swaggerEnabled) {
    const swaggerCfg = new DocumentBuilder()
      .setTitle('WOW - World of Weddings API')
      .setDescription('API documentation for the WOW platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerCfg);
    SwaggerModule.setup(`${cfg.runtime.apiPrefix}/docs`, app, document);
  }

  /*
   * Every link the platform hands out -- the event invitation a host forwards
   * to a guest, the password reset, the agent's client sign-up link -- is
   * built from APP_BASE_URL. If that still points at localhost outside
   * development then all of them are unreachable for the person who receives
   * them, and nothing about the platform looks broken from the inside: the
   * host sees a link, sends it, and the guest sees "not available"
   * (EZ1-I178, reopened as EZ1-I232).
   *
   * Said once, loudly, at boot. Not fatal, because refusing to start would
   * take a running deployment down over a setting it has survived without so
   * far -- but nobody reading the logs can now miss why the links are wrong.
   */
  if (cfg.runtime.env === 'production' && /localhost|127\.0\.0\.1/.test(cfg.mail.appBaseUrl)) {
    new Logger('Bootstrap').error(
      `APP_BASE_URL is ${cfg.mail.appBaseUrl}. Every invitation, reset and RSVP link this ` +
        'deployment sends will point at the server itself and will not open for the person ' +
        'who receives it. Set APP_BASE_URL to the address users reach the portal on.',
    );
  }

  /*
   * With SMS_PROVIDER=log nothing is delivered: one-time codes and SMS
   * invitations are written to the server log. Right on a developer's machine;
   * anywhere people use, it is a sign-in by mobile nobody can complete. Said at
   * boot for the same reason as APP_BASE_URL above (EZ1-I258).
   */
  if (cfg.runtime.env === 'production' && cfg.sms.provider === 'log') {
    new Logger('Bootstrap').error(
      'SMS_PROVIDER is log. One-time sign-in codes and SMS invitations are written to the ' +
        'server log and never delivered. Set SMS_PROVIDER=http and its credentials for any ' +
        'deployment people actually use.',
    );
  }

  await app.listen(cfg.runtime.port);
}

void bootstrap();
