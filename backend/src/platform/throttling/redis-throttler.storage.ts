import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisService } from '../redis/redis.service';

/**
 * Shared rate-limit counters in Redis.
 *
 * The default storage is per-process memory, so with N replicas the effective
 * limit was N times the configured one, and every deploy reset it. Redis is
 * already a hard dependency for caching and the Socket.io adapter, so this
 * needs no new infrastructure.
 *
 * INCR + EXPIRE run in one pipeline so a counter can never be created without
 * a TTL (which would let it survive forever and permanently lock a key out).
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(key: string, ttl: number): Promise<ThrottlerStorageRecord> {
    const redisKey = `throttle:${key}`;
    // @nestjs/throttler v5 passes the TTL in milliseconds.
    const ttlSeconds = Math.max(1, Math.ceil(ttl / 1000));

    const results = await this.redis.raw
      .multi()
      .incr(redisKey)
      .expire(redisKey, ttlSeconds, 'NX') // only on first hit, so the window does not slide
      .pttl(redisKey)
      .exec();

    const totalHits = Number(results?.[0]?.[1] ?? 1);
    const pttl = Number(results?.[2]?.[1] ?? ttl);

    return {
      totalHits,
      // A -1/-2 pttl means the key lost its TTL or vanished between commands;
      // fall back to the configured window rather than reporting "expired".
      timeToExpire: pttl > 0 ? Math.ceil(pttl / 1000) : ttlSeconds,
    };
  }
}
