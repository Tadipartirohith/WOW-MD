import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment.provider';
import { Public } from '../../common/decorators/public.decorator';
import { AuditAction, AuditService } from '../../platform/audit/audit.service';
import { RedisService } from '../../platform/redis/redis.service';

/**
 * Inbound gateway webhooks.
 *
 * Public because the gateway is not a WOW user, but every request must carry a
 * valid HMAC over the RAW body — see `rawBody` capture in main.ts. Without that
 * check anyone who learned a payment reference could post a "captured" event
 * and move a booking along.
 *
 * Replays are dropped by remembering the provider's event id in Redis, since
 * gateways retry aggressively and at-least-once delivery is the norm.
 */
@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  private static readonly REPLAY_TTL_SECONDS = 24 * 60 * 60;

  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @Inject(PAYMENT_PROVIDER) private readonly gateway: PaymentProvider,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @ApiExcludeEndpoint()
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @HttpCode(200)
  @Post('webhook')
  async webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') razorpaySignature?: string,
    @Headers('x-wow-signature') mockSignature?: string,
  ) {
    const raw = req.rawBody?.toString('utf8');
    if (!raw) throw new BadRequestException('Missing request body');

    const event = this.gateway.verifyWebhook(raw, razorpaySignature ?? mockSignature);
    if (!event) {
      await this.audit.record({
        action: AuditAction.PAYMENT_WEBHOOK_REJECTED,
        resourceType: 'payment',
        metadata: { reason: 'signature verification failed' },
        ip: req.ip ?? null,
      });
      // 400, not 401: the gateway is not "unauthenticated", the payload is bad.
      throw new BadRequestException('Invalid signature');
    }

    const replayKey = `payment:webhook:${event.eventId}`;
    const seen = await this.redis.raw.set(
      replayKey,
      '1',
      'EX',
      PaymentsController.REPLAY_TTL_SECONDS,
      'NX',
    );
    if (seen === null) return { received: true, duplicate: true };

    if (event.providerRef) {
      const payment = await this.payments.findOne({ where: { providerRef: event.providerRef } });
      if (payment) {
        // Record what the gateway said, but never let a webhook drive the
        // booking state machine: that stays under the escrow rules in
        // BookingsService, where authorization is enforced.
        await this.payments.update(payment.id, {
          providerStatus: event.status,
          webhookVerifiedAt: new Date(),
        });
      }
    }

    await this.audit.record({
      action: AuditAction.PAYMENT_WEBHOOK_RECEIVED,
      resourceType: 'payment',
      resourceId: null,
      metadata: { eventId: event.eventId, type: event.type, status: event.status },
      ip: req.ip ?? null,
    });

    return { received: true };
  }
}
