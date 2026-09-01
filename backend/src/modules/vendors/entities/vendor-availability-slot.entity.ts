import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProviderType } from '../../../common/enums';
import { SlotStatus } from '../../../common/enums';

/**
 * One bookable window in a vendor's calendar.
 *
 * A slot is **not** the booking. It is the thing bookings point at, and it
 * outlives them: the vendor's history, the payment trail and any later dispute
 * all need to know which window was sold, so the row stays whatever happens to
 * the bookings against it.
 *
 * `status` records the vendor's own decision — published, blocked, cancelled.
 * Everything a reader actually wants is arithmetic over `capacity`,
 * `confirmed` and `pending`, computed in `AvailabilityService.view`:
 *
 *   remaining = capacity - confirmed
 *   open      = published and remaining > 0
 *   booked    = confirmed > 0            (may still be open)
 *   full      = remaining === 0          (cannot take another)
 *
 * Keeping those derived rather than stored is what stops "has bookings" and
 * "cannot take another" collapsing into one flag, and what makes `remaining`
 * impossible to get out of step with reality.
 */
@Entity('vendor_availability_slots')
@Index(['providerType', 'providerId', 'date'])
export class VendorAvailabilitySlot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Which kind of provider this belongs to.
   *
   * A planner takes bookings against dates exactly as a vendor does, and
   * bookings have carried providerType since they were written; availability
   * was the one part of that story that did not, so a planner had no way to
   * publish the weeks they could work.
   */
  @Index()
  @Column({ type: 'enum', enum: ProviderType, default: ProviderType.VENDOR })
  providerType: ProviderType;

  /**
   * The listing this belongs to: a Vendor id or a PlannerProfile id.
   *
   * Renamed from `vendorId` rather than joined by one. Storing a planner's id
   * in a column called vendorId is a lie that outlives everybody who knows
   * about it, and every read below pairs it with providerType so two providers
   * holding the same uuid could never share a slot.
   */
  @Index()
  @Column('uuid')
  providerId: string;

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

  /**
   * Confirmed bookings against the window. Never exceeds `capacity`.
   *
   * This is the only counter capacity is measured against: `remaining` is
   * `capacity - confirmed`, and nothing else.
   */
  @Column({ type: 'int', default: 0 })
  confirmed: number;

  /**
   * Requests waiting on the vendor's answer.
   *
   * Deliberately **not** subtracted from capacity. A request is a question; a
   * booking is the answer. Counting the question would take a caterer's
   * five-team afternoon off sale because one family enquired about it — which
   * is exactly what the previous design did.
   */
  @Column({ type: 'int', default: 0 })
  pending: number;

  @Index()
  @Column({ type: 'enum', enum: SlotStatus, default: SlotStatus.AVAILABLE })
  status: SlotStatus;

  /**
   * Historic. A window used to hold exactly one booking, and this was it.
   *
   * Kept so existing rows still load, and never written to now: with capacity
   * a window holds several bookings, and `bookings.slotId` is the edge that
   * carries them.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  bookingId: string | null;

  /**
   * Which of the vendor's services this window is for.
   *
   * Null on a window published before the catalog existed, and on a vendor who
   * has not moved onto it. When it is set, the service's `concurrentCapacity`
   * is where this slot's capacity comes from — which is how a caterer runs
   * five teams in one afternoon and a convention hall runs one.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  vendorServiceId: string | null;

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
