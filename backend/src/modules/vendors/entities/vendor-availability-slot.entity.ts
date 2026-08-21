import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SlotStatus } from '../../../common/enums';

/**
 * One bookable window in a vendor's calendar.
 *
 * A slot is **not** the booking. It is the thing a booking points at, and it
 * outlives one: when a booking is confirmed the slot goes to BOOKED and stays
 * in the table, because the vendor's history, the payment trail and any later
 * dispute all need to know which window was sold. Only the buyer's list of
 * choices loses it.
 *
 * Capacity and bookability are deliberately separate. A hall that seats 20 is
 * still one event: `capacity` describes the venue, `booked` counts confirmed
 * events against it, and for the common case both are one.
 */
@Entity('vendor_availability_slots')
@Index(['vendorId', 'date'])
export class VendorAvailabilitySlot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  vendorId: string;

  @Index()
  @Column({ type: 'date' })
  date: string;

  /** 24-hour HH:MM. Stored as time so the database can order and compare them. */
  @Column({ type: 'time' })
  startTime: string;

  @Column({ type: 'time' })
  endTime: string;

  /**
   * How many events this window can take. Almost always one; a caterer with two
   * teams is the exception the field exists for.
   */
  @Column({ type: 'int', default: 1 })
  capacity: number;

  /** Confirmed bookings against the window. Never exceeds `capacity`. */
  @Column({ type: 'int', default: 0 })
  booked: number;

  @Index()
  @Column({ type: 'enum', enum: SlotStatus, default: SlotStatus.AVAILABLE })
  status: SlotStatus;

  /** The booking currently holding it, once one does. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  bookingId: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  note: string | null;

  /** Why the vendor made it unavailable — a holiday, their own wedding. */
  @Column({ type: 'varchar', length: 200, nullable: true })
  blockReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
