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

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'text', nullable: true })
  cancellationReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
