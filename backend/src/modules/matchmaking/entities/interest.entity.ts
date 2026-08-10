import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { InterestStatus } from '../../../common/enums';

@Entity('interests')
@Unique(['fromUserId', 'toUserId'])
export class Interest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  fromUserId: string;

  @Index()
  @Column('uuid')
  toUserId: string;

  @Index()
  @Column({ type: 'enum', enum: InterestStatus, default: InterestStatus.PENDING })
  status: InterestStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
