import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PricingModel } from '../../../common/enums';

/**
 * A priced thing a buyer can actually choose: "Full day, two photographers,
 * ₹85,000" or "Per plate, veg, ₹450".
 *
 * A vendor service needs at least one offering to be bookable — a service with
 * none is a description with no price attached, and the request form has
 * nothing to submit.
 */
@Entity('service_offerings')
export class ServiceOffering {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  vendorServiceId: string;

  @Column({ type: 'varchar', length: 140 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: PricingModel })
  pricingModel: PricingModel;

  /**
   * Null for CUSTOM_QUOTE and NO_PUBLIC_PRICE, which is the whole point of
   * those two models: the vendor quotes after seeing the requirements.
   */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  price: string | null;

  @Column({ default: 'INR' })
  currency: string;

  /**
   * A price change waiting on an administrator, when review is switched on.
   *
   * Held beside the live price rather than replacing it, and that is the whole
   * design. A vendor who doubles their rate on a live listing should not take
   * their shop off sale while somebody looks at it — the old price keeps
   * selling, and the new one applies the moment it is approved. Storing the
   * proposal in `price` and a flag beside it would mean either serving an
   * unreviewed price or serving none.
   */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  pendingPrice: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  pendingSince: Date | null;

  /** "per plate", "per hour", "per day" — what the price is *of*. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  unitLabel: string | null;

  /** PER_PERSON / PER_ITEM: the minimum the vendor will take. */
  @Column({ type: 'int', nullable: true })
  minQuantity: number | null;

  @Column({ type: 'int', nullable: true })
  maxQuantity: number | null;

  /**
   * Whether this offering groups several things together.
   *
   * Optional by design — see `ServiceDefinition.packagesAllowed`. A package is
   * a presentation choice, not a different kind of record.
   */
  @Column({ default: false })
  isPackage: boolean;

  /** What the package contains, when it is one. Free text, shown as a list. */
  @Column({ type: 'jsonb', default: [] })
  inclusions: string[];

  @Index()
  @Column({ default: true })
  active: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
