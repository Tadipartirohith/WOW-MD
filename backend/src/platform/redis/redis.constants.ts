// Injection tokens kept in their own module to avoid a circular import between
// redis.module.ts and its consumers (redis.service.ts, redis-io.adapter.ts).
export const REDIS_CLIENT = 'REDIS_CLIENT';
export const REDIS_SUBSCRIBER = 'REDIS_SUBSCRIBER';
