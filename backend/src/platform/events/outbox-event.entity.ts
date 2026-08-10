import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Transactional outbox. Domain writes and their events commit in the SAME DB
 * transaction, guaranteeing the two never diverge. A background processor
 * dispatches unprocessed rows to in-process/remote consumers.
 */
@Entity('outbox_events')
export class OutboxEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  aggregateType: string;

  @Column()
  eventType: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
