import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { EventBus } from './event-bus.service';
import { KafkaService } from '../messaging/kafka.service';

/**
 * Polls the outbox and re-publishes events onto the in-process bus, then marks
 * them processed. Interval is intentionally simple; in production this becomes a
 * dedicated worker consuming from a broker.
 */
@Injectable()
export class OutboxProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxProcessor.name);
  private timer?: NodeJS.Timeout;
  private readonly intervalMs = 2000;
  private readonly batchSize = 50;

  constructor(
    private readonly outbox: OutboxService,
    private readonly bus: EventBus,
    private readonly kafka: KafkaService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      const events = await this.outbox.findUnprocessed(this.batchSize);
      for (const e of events) {
        const event = {
          eventType: e.eventType,
          aggregateType: e.aggregateType,
          payload: e.payload,
        };
        this.bus.publish(event);
        await this.kafka.publish(event); // no-op unless Kafka is enabled
        await this.outbox.markProcessed(e.id);
      }
    } catch (err) {
      this.logger.error('Outbox processing failed', err instanceof Error ? err.stack : String(err));
    }
  }
}
