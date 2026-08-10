import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TaskStatus } from '../../../common/enums';
import { WeddingPlan } from './wedding-plan.entity';

@Entity('plan_tasks')
export class PlanTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  planId: string;

  @ManyToOne(() => WeddingPlan, (plan) => plan.tasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'planId' })
  plan: WeddingPlan;

  @Column()
  title: string;

  @Column({ nullable: true })
  category: string;

  @Column({ type: 'date', nullable: true })
  dueDate: string | null;

  @Index()
  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.PENDING })
  status: TaskStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
