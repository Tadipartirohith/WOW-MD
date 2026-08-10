import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';
import { AppConfigService } from '../../config/app-config.service';
import { DomainEvent } from '../events/event-bus.service';

/**
 * Optional Kafka producer. When KAFKA_ENABLED is false (default) publish() is a
 * no-op and `ready` is false, so the outbox still delivers events over the
 * in-process bus. When enabled, each processed outbox event is also published to
 * Kafka, which is the seam for extracting services later.
 */
@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private producer: Producer | null = null;
  private _ready = false;

  constructor(private readonly cfg: AppConfigService) {}

  get ready(): boolean {
    return this._ready;
  }

  async onModuleInit(): Promise<void> {
    if (!this.cfg.kafka.enabled) {
      this.logger.log('Kafka disabled; events stay on the in-process bus.');
      return;
    }
    try {
      const kafka = new Kafka({ clientId: this.cfg.kafka.clientId, brokers: this.cfg.kafka.brokers });
      this.producer = kafka.producer();
      await this.producer.connect();
      this._ready = true;
      this.logger.log('Kafka producer connected.');
    } catch (err) {
      this._ready = false;
      this.logger.warn(`Kafka unavailable: ${err instanceof Error ? err.message : err}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer?.disconnect();
  }

  async publish(event: DomainEvent): Promise<void> {
    if (!this._ready || !this.producer) return;
    await this.producer.send({
      topic: this.cfg.kafka.topic,
      messages: [{ key: event.eventType, value: JSON.stringify(event) }],
    });
  }
}
