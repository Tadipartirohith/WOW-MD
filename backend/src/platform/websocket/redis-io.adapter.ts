import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from '../redis/redis.constants';

/**
 * Socket.io adapter backed by Redis pub/sub so messages fan out across ALL
 * backend replicas. Without this, horizontal scaling silently breaks chat.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const pubClient = this.app.get<Redis>(REDIS_CLIENT);
    const subClient = this.app.get<Redis>(REDIS_SUBSCRIBER);
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
