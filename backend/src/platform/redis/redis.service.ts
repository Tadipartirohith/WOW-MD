import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from './redis.constants';
import { AppConfigService } from '../../config/app-config.service';

/** Thin cache-aside helper over ioredis. TTLs default from config. */
@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
    private readonly cfg: AppConfigService,
  ) {}

  get raw(): Redis {
    return this.client;
  }

  /** Close both connections on shutdown so tests and pods exit cleanly. */
  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.client.quit(), this.subscriber.quit()]);
  }

  async get<T>(key: string): Promise<T | null> {
    const val = await this.client.get(key);
    return val ? (JSON.parse(val) as T) : null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.cfg.redis.defaultTtlSeconds;
    await this.client.set(key, JSON.stringify(value), 'EX', ttl);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.client.del(...keys);
  }

  /** Cache-aside: return cached value or compute, store, and return it. */
  async wrap<T>(key: string, ttlSeconds: number, producer: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const fresh = await producer();
    await this.set(key, fresh, ttlSeconds);
    return fresh;
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }
}
