import { Injectable } from '@nestjs/common';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { OutboxEvent } from './outbox-event.entity';
import { DomainEvent } from './event-bus.service';

@Injectable()
export class OutboxService {
  constructor(
    @InjectRepository(OutboxEvent)
    private readonly repo: Repository<OutboxEvent>,
  ) {}

  /**
   * Persist an event as part of an existing transaction (pass the txn manager).
   * Falls back to a standalone write if no manager is supplied.
   */
  async record(event: DomainEvent, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(OutboxEvent) : this.repo;
    const row = repo.create({
      aggregateType: event.aggregateType,
      eventType: event.eventType,
      payload: event.payload,
      processedAt: null,
    });
    await repo.save(row);
  }

  findUnprocessed(limit: number): Promise<OutboxEvent[]> {
    return this.repo.find({
      where: { processedAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async markProcessed(id: string): Promise<void> {
    await this.repo.update(id, { processedAt: new Date() });
  }
}
