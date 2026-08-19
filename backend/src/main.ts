import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
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

  await app.listen(cfg.runtime.port);
}

void bootstrap();
