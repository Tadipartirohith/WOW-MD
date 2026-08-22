import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentMilestone, PaymentStatus } from '../../../common/enums';

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  bookingId: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  /** Platform commission withheld on release. */
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  commissionAmount: string;

  /** What the provider actually receives: amount minus commission. */
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  payoutAmount: string;

  @Column({ default: 'INR' })
  currency: string;

  @Index()
  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.INITIATED })
  status: PaymentStatus;

  /**
   * Which instalment this is. A booking holds at most one payment per
   * milestone, enforced by a partial unique index in the migration — retrying a
   * failed advance must not produce two live holds for the same instalment.
   */
  @Index()
  @Column({ type: 'enum', enum: PaymentMilestone, default: PaymentMilestone.ADVANCE })
  milestone: PaymentMilestone;

  @Column()
  provider: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  providerRef: string | null;

  /**
   * Caller-supplied key that makes a retried pay request return the original
   * payment instead of creating a second escrow hold.
   */
  @Index({ unique: true, where: '"idempotencyKey" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  idempotencyKey: string | null;

  /** The gateway's reference for the payout transfer, once one is made. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  payoutRef: string | null;

  /**
   * Why the payout has not happened, when it has not.
   *
   * Kept on the row rather than only in the log, because the operator who needs
   * it is looking at a ledger showing money owed, not at yesterday's stdout.
   */
  @Column({ type: 'text', nullable: true })
  payoutNote: string | null;

  /** Last status string the gateway reported, verbatim, for reconciliation. */
  @Column({ type: 'varchar', nullable: true })
  providerStatus: string | null;

  /** Set when a signed webhook confirmed this payment out-of-band. */
  @Column({ type: 'timestamptz', nullable: true })
  webhookVerifiedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
