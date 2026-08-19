import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Append-only record of privileged and money-moving actions.
 *
 * There is no update or delete path in AuditService by design: an audit trail
 * that the application can rewrite is not an audit trail.
 */
@Entity('audit_events')
@Index(['resourceType', 'resourceId'])
export class AuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Null for unauthenticated actions such as a failed login. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'varchar', nullable: true })
  actorRole: string | null;

  /** Dotted action name, e.g. 'booking.escrow_released'. */
  @Index()
  @Column()
  action: string;

  @Column({ type: 'varchar', nullable: true })
  resourceType: string | null;

  @Column({ type: 'uuid', nullable: true })
  resourceId: string | null;

  /** Never put secrets or full payloads here; identifiers and amounts only. */
  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
