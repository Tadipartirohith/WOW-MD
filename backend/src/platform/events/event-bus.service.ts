import { Injectable } from '@nestjs/common';
import { Subject, filter, Observable } from 'rxjs';

export interface DomainEvent<T = Record<string, unknown>> {
  eventType: string;
  aggregateType: string;
  payload: T;
}

/**
 * Lightweight in-process event bus. When a module is extracted into its own
 * service, this is swapped for a real broker (NATS/Kafka) behind the same API.
 */
@Injectable()
export class EventBus {
  private readonly stream$ = new Subject<DomainEvent>();

  publish(event: DomainEvent): void {
    this.stream$.next(event);
  }

  on<T = Record<string, unknown>>(eventType: string): Observable<DomainEvent<T>> {
    return this.stream$.pipe(filter((e) => e.eventType === eventType)) as Observable<DomainEvent<T>>;
  }
}
