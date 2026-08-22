import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A vendor's instance of a service definition — "Sharma Studios does candid
 * photography, covers Hyderabad and Warangal, two crews".
 *
 * `attributes` holds the answers to the definition's SERVICE-scope questions,
 * validated against them on every write. Storing them as jsonb rather than as
 * columns is what lets an administrator add a question without a migration;
 * the validator is what stops that becoming a free-for-all.
 */
@Entity('vendor_services')
@Index(['vendorId', 'definitionId'], { unique: true })
export class VendorService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  vendorId: string;

  @Index()
  @Column('uuid')
  definitionId: string;

  /** Overrides the definition's name when the vendor has their own wording. */
  @Column({ type: 'varchar', length: 140, nullable: true })
  displayName: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', default: {} })
  attributes: Record<string, unknown>;

  /**
   * How many of these the vendor can run at once.
   *
   * This is the number the specification's catering example turns on: five
   * teams means five simultaneous bookings in one window, and one convention
   * hall means one. It seeds the capacity of every slot published for this
   * service.
   */
  @Column({ type: 'int', default: 1 })
  concurrentCapacity: number;

  /** Vendor-side switch. Taking a service down leaves its bookings intact. */
  @Index()
  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
