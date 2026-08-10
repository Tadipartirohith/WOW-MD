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

  @Index()
  @Column({ default: false })
  isRead: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
