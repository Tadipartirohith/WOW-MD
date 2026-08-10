import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PlanTask } from './plan-task.entity';

@Entity('wedding_plans')
export class WeddingPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'date' })
  weddingDate: string;

  @OneToMany(() => PlanTask, (task) => task.plan)
  tasks: PlanTask[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
