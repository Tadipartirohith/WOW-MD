import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BookingAddonStatus } from '../../../common/enums';

/**
 * An extra service the buyer asks for on a booking whose advance is already
 * held (EZ1-I215).
 *
 * Conceptually a mini-quotation: the buyer proposes an add-on (optionally at a
 * predefined price), and the vendor accepts, rejects, or requotes with their
 * own price for the buyer to accept. Rows are never edited away, so what was
 * agreed on top of the booking, and at what price, stays reconstructable.
 *
 * Paying an accepted add-on into escrow is deliberately out of scope here: the
 * row records the agreed extra and its price; a follow-up wires the instalment.
 */
@Entity('booking_addons')
export class BookingAddon {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  bookingId: string;

  /** The buyer (or the agent on their behalf) who asked for it. */
  @Index()
  @Column('uuid')
  requestedByUserId: string;

  /** The extra service or package being asked for. */
  @Column()
  title: string;

  /** What the buyer needs — the requirements for the extra. */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  /** The buyer's asked price, when the add-on has a predefined one. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  proposedPrice: string | null;

  /**
   * The vendor's price: copied from the proposed price on a straight accept, or
   * set fresh on a requote. This is the agreed amount once the status is
   * ACCEPTED.
   */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  vendorPrice: string | null;

  @Column({ default: 'INR' })
  currency: string;

  /** The buyer's covering note. */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Index()
  @Column({ type: 'enum', enum: BookingAddonStatus, default: BookingAddonStatus.REQUESTED })
  status: BookingAddonStatus;

  /** Who last responded — the vendor on accept/reject/requote, the buyer on accepting a requote. */
  @Column({ type: 'uuid', nullable: true })
  respondedByUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  responseNote: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
