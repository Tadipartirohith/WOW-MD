import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { RedisService } from './redis.service';
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from './redis.constants';

const buildClient = (cfg: AppConfigService) =>
  new Redis({
    host: cfg.redis.host,
    port: cfg.redis.port,
    password: cfg.redis.password,
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });

@Global()
@Module({
  providers: [
    { provide: REDIS_CLIENT, inject: [AppConfigService], useFactory: buildClient },
    { provide: REDIS_SUBSCRIBER, inject: [AppConfigService], useFactory: buildClient },
    RedisService,
  ],
  exports: [REDIS_CLIENT, REDIS_SUBSCRIBER, RedisService],
})
export class RedisModule {}
