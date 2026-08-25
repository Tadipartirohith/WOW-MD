import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  CasePriority,
  CaseStatus,
  CaseSubject,
  PaymentMilestone,
  SettlementOutcome,
} from '../../../common/enums';

/**
 * An issue raised against an agent, vendor, profile, match, booking or payment.
 *
 * Cases exist so that a dispute has somewhere to live while money sits in
 * escrow. Admin triages and allocates; a verification officer investigates on
 * the ground; the settlement decision is recorded here and mirrored onto the
 * payment, so neither record can drift from the other.
 */
@Entity('support_cases')
@Index(['subjectType', 'subjectId'])
export class SupportCase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: CaseSubject })
  subjectType: CaseSubject;

  @Column({ type: 'uuid', nullable: true })
  subjectId: string | null;

  @Index()
  @Column('uuid')
  raisedByUserId: string;

  @Column()
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Index()
  @Column({ type: 'enum', enum: CaseStatus, default: CaseStatus.OPEN })
  status: CaseStatus;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  assignedToUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  allocatedAt: Date | null;

  /** What the officer found on investigation. */
  /**
   * Where the booking stood when this case froze it.
   *
   * A settlement has to put the booking back into its own flow, not invent a
   * new position for it: a dispute raised mid-job ends with the job still
   * mid-job. Without this the only options are guessing or leaving it frozen.
   */
  @Column({ type: 'varchar', nullable: true })
  bookingPreviousStatus: string | null;

  /**
   * Which instalment the argument is about.
   *
   * "They never turned up" and "the album is three months late" are disputes
   * over different money, and an officer choosing between release and refund
   * has to know which. Null for a case that is not about a payment at all.
   */
  @Column({ type: 'varchar', nullable: true })
  milestone: PaymentMilestone | null;

  /** URLs of what was uploaded to support the claim. */
  @Column({ type: 'jsonb', default: [] })
  evidence: string[];

  /**
   * Marks a case nobody can settle from a desk — the hall that does not exist,
   * the caterer whose kitchen is somebody's front room.
   */
  @Index()
  @Column({ default: false })
  requiresPhysicalVerification: boolean;

  @Column({ type: 'text', nullable: true })
  findings: string | null;

  @Column({ type: 'enum', enum: SettlementOutcome, nullable: true })
  settlementOutcome: SettlementOutcome | null;

  /** Amount actually moved, for a partial settlement. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  settlementAmount: string | null;

  @Column({ type: 'text', nullable: true })
  settlementNotes: string | null;

  /** Set at triage. Drives the queue order, not the complainant's adjectives. */
  @Column({ type: 'enum', enum: CasePriority, default: CasePriority.NORMAL })
  priority: CasePriority;

  /** A free label from triage — "payment", "listing", "conduct". */
  @Column({ type: 'varchar', length: 64, nullable: true })
  category: string | null;

  /**
   * When the platform finished with it, as distinct from when the complainant
   * did. Two timestamps because they answer two different questions: how fast
   * the desk works, and whether the answer was accepted.
   */
  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  resolvedByUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  closedByUserId: string | null;

  @Column({ type: 'jsonb', default: [] })
  history: { at: string; byUserId: string; status: string; note?: string }[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
