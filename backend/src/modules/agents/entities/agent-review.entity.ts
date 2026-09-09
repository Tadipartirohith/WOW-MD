import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A managed client's rating of the agent who represents them.
 *
 * Unlike a vendor review — one per completed job, because two jobs are two
 * experiences — a client has a single, standing relationship with their agent.
 * So the shape is one review per (agent, client) pair, editable in place: the
 * unique index below is what makes the upsert a correction rather than a second
 * opinion.
 *
 * Only a user whose `managedByAgentId` points at the agent may write here; the
 * controller guards that on every submission.
 */
@Entity('agent_reviews')
@Index('UQ_agent_review_agent_user', ['agentId', 'userId'], { unique: true })
export class AgentReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The agent (a user with role AGENT) being rated. */
  @Index()
  @Column('uuid')
  agentId: string;

  /** The managed client who wrote it. */
  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'int' })
  rating: number; // 1-5

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
