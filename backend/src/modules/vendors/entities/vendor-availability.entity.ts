import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * A day in a vendor's calendar.
 *
 * Modelled per day rather than per time range because that is how wedding
 * services are actually sold: a photographer or a mandap decorator is booked
 * for a date, not for two hours of it. `capacity` covers the vendors who can
 * genuinely take more than one event a day — a caterer with two teams.
 */
@Entity('vendor_availability')
@Unique(['vendorId', 'date'])
export class VendorAvailability {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  vendorId: string;

  @Index()
  @Column({ type: 'date' })
  date: string;

  /**
   * How many bookings this date can take. Zero is the vendor blocking the day
   * out — a wedding of their own, a holiday — and is the reason `isAvailable`
   * is not a boolean: "blocked" and "fully booked" need to read differently to
   * the buyer.
   */
  @Column({ type: 'int', default: 1 })
  capacity: number;

  /** Confirmed bookings against this date. Never exceeds `capacity`. */
  @Column({ type: 'int', default: 0 })
  booked: number;

  @Column({ type: 'varchar', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
