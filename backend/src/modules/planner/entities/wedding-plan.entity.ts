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

  /**
   * The PLANNER account engaged on this wedding, if any. Set by the host; grants
   * that planner write access to the plan and its tasks.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  plannerUserId: string | null;

  /**
   * The booking that pays for the engagement. A planner only gets write access
   * once this booking is confirmed, so plan access always has a paid contract
   * behind it.
   */
  @Column({ type: 'uuid', nullable: true })
  plannerBookingId: string | null;

  // Nullable so a plan can exist before its date is known — a couple who books
  // a planner before starting their own plan (EZ1-I116). Every reader treats it
  // as optional.
  @Column({ type: 'date', nullable: true })
  weddingDate: string | null;

  @OneToMany(() => PlanTask, (task) => task.plan)
  tasks: PlanTask[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
