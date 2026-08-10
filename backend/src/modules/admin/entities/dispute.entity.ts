import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DisputeStatus } from '../../../common/enums';

@Entity('disputes')
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  bookingId: string;

  @Column('uuid')
  raisedBy: string;

  @Column({ type: 'text' })
  reason: string;

  @Index()
  @Column({ type: 'enum', enum: DisputeStatus, default: DisputeStatus.OPEN })
  status: DisputeStatus;

  @Column({ type: 'text', nullable: true })
  resolution: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
