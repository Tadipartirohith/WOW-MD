import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AgentChargeType, PaymentStatus } from '../../../common/enums';

/**
 * What an agency bills a client, and where that money currently sits.
 *
 * Kept apart from `payments`, which belongs to the vendor marketplace, because
 * the two answer different questions: a payment is attached to a booking for a
 * service, an agent charge is attached to a *profile* and to the matchmaking
 * work done on it. Sharing one table would mean every booking query carrying a
 * "but not the agency fees" clause forever.
 *
 * Escrow works the same way in both, though: the money is held, and it is
 * released to the agency only when the outcome it was charged for actually
 * happened.
 */
@Entity('agent_charges')
export class AgentCharge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The agency the money is owed to. */
  @Index()
  @Column('uuid')
  agentUserId: string;

  /** The profile the work was done on. */
  @Index()
  @Column('uuid')
  profileId: string;

  /**
   * The account that pays. Null for a walk-in client with no account — the
   * charge is still recorded against the profile, and settles when they get
   * one or when the agency records it as collected.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  payerUserId: string | null;

  @Index()
  @Column({ type: 'enum', enum: AgentChargeType })
  type: AgentChargeType;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  /** The platform's cut, withheld on release. */
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  commissionAmount: string;

  /** What actually reaches the agency. */
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  payoutAmount: string;

  @Column({ default: 'INR' })
  currency: string;

  @Index()
  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.INITIATED })
  status: PaymentStatus;

  @Column({ type: 'varchar', nullable: true })
  providerRef: string | null;

  /** The fixed match this settlement fee is for. Null for a profile fee. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  interestId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  releasedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
