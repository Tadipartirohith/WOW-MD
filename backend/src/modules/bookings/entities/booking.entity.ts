import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BookingStatus, ProviderType } from '../../../common/enums';

@Entity('bookings')
@Index(['providerType', 'providerId'])
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The client the booking is *for*. Escrow refunds go back to this account. */
  @Index()
  @Column('uuid')
  userId: string;

  /**
   * Who actually placed it. Equals `userId` for a self-service booking; for an
   * agent booking on a client's behalf this is the agent, giving a clean audit
   * trail of who acted.
   */
  @Index()
  @Column('uuid')
  bookedByUserId: string;

  /** Which directory the provider lives in. */
  @Column({ type: 'enum', enum: ProviderType, default: ProviderType.VENDOR })
  providerType: ProviderType;

  /** Vendor.id or PlannerProfile.id, depending on providerType. */
  @Index()
  @Column('uuid')
  providerId: string;

  @Index()
  @Column({ type: 'enum', enum: BookingStatus, default: BookingStatus.REQUESTED })
  status: BookingStatus;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  amount: string;

  @Column({ default: 'INR' })
  currency: string;

  @Column({ type: 'date', nullable: true })
  eventDate: string | null;

  /**
   * The published window this booking holds.
   *
   * A booking without one is a legacy row or a planner engagement; for a vendor
   * the slot is what stops the same afternoon being sold twice.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  slotId: string | null;

  /** The wedding event this is for — the reception, the mehendi. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  eventId: string | null;

  /**
   * What the buyer actually needs: guest count, menu, timings, anything the
   * provider must know to price the job. Mandatory on a vendor request, because
   * a quotation written without it is a guess.
   */
  @Column({ type: 'text', nullable: true })
  requirements: string | null;

  /**
   * What the buyer hopes to spend. Optional on purpose — the provider quotes
   * against the requirements, and forcing a number out of someone who does not
   * have one only produces a fictional one.
   */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  expectedBudget: string | null;

  /** Set when the provider confirms they have started. */
  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  /** Set when the provider says the work is delivered. */
  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'text', nullable: true })
  cancellationReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
