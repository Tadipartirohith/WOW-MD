import { Injectable } from '@nestjs/common';
import { RedisService } from '../../platform/redis/redis.service';

/** How long after the last heartbeat somebody still counts as online. */
const PRESENCE_TTL_SECONDS = 90;

const key = (userId: string) => `presence:${userId}`;

/**
 * Who is online.
 *
 * Kept in Redis with a short TTL rather than as a boolean flag, because the
 * failure mode of a flag is somebody appearing online forever after their
 * laptop lid closed — the socket never disconnects cleanly, the flag never
 * clears, and the other family sits waiting for a reply from a green dot. A
 * key that expires on its own is wrong for at most ninety seconds.
 *
 * Shared state, not per-process: with several replicas behind a load balancer
 * the socket and the HTTP request that asks about it are rarely on the same
 * one.
 */
@Injectable()
export class PresenceService {
  constructor(private readonly redis: RedisService) {}

  /** Called on connect and refreshed on every heartbeat. */
  async markOnline(userId: string): Promise<void> {
    await this.redis.raw.set(key(userId), Date.now().toString(), 'EX', PRESENCE_TTL_SECONDS);
  }

  /** A clean disconnect. An unclean one is handled by the TTL. */
  async markOffline(userId: string): Promise<void> {
    await this.redis.raw.del(key(userId));
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.raw.exists(key(userId))) === 1;
  }

  /** One round trip for a whole conversation list. */
  async onlineAmong(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const values = await this.redis.raw.mget(...userIds.map(key));
    const online = new Set<string>();
    userIds.forEach((id, i) => {
      if (values[i] !== null) online.add(id);
    });
    return online;
  }

  /**
   * When they were last seen, for the "last seen 20 minutes ago" line. Null
   * means we have no record — they have not been online since the key expired,
   * which is deliberately not the same as "never".
   */
  async lastSeen(userId: string): Promise<Date | null> {
    const value = await this.redis.raw.get(key(userId));
    return value ? new Date(Number(value)) : null;
  }
}
