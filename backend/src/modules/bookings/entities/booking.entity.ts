import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BookingStatus } from '../../../common/enums';

@Entity('bookings')
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column('uuid')
  vendorId: string;

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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
