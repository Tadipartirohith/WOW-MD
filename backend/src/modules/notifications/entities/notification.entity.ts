import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { NotificationType } from '../../../common/enums';

@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  /**
   * Where this notification takes the reader, and what they do there.
   *
   * Stored rather than derived at read time so a notification sent to a phone
   * carries its own destination. Nullable only for rows written before the
   * columns existed; everything new gets both.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  targetModule: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  targetAction: string | null;

  /** The id the target is about, lifted out of the payload when it is there. */
  @Column({ type: 'uuid', nullable: true })
  targetId: string | null;

  @Index()
  @Column({ default: false })
  isRead: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
