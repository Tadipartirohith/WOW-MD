import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisService,
  ) {}

  /** Liveness, process is up. Used by k8s livenessProbe. */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness, dependencies reachable. Used by k8s readinessProbe & LB. */
  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 1500 }),
      async (): Promise<HealthIndicatorResult> => {
        const ok = await this.redis.ping();
        return { redis: { status: ok ? 'up' : 'down' } };
      },
    ]);
  }
}
