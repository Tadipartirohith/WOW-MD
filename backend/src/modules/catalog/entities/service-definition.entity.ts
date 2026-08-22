import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AvailabilityModel, PricingModel } from '../../../common/enums';

/**
 * A kind of service a vendor can offer: "Candid photography", "Wedding day
 * priest", "Bridal makeup".
 *
 * This is the row that replaces a module. Everything the platform needs to
 * know about how to list, price, schedule and book a service type is on here
 * or on its attributes — which is what stops the codebase growing an `if
 * (category === CATERING)` branch every time the business signs a new trade.
 */
@Entity('service_definitions')
@Index(['categoryId', 'slug'], { unique: true })
export class ServiceDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  categoryId: string;

  @Column({ type: 'varchar', length: 60 })
  slug: string;

  @Column({ type: 'varchar', length: 140 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /**
   * Which pricing models a vendor may choose from for this service.
   *
   * A venue is sensibly per-day or fixed; a caterer is per-person; a priest is
   * per-session. Constraining the list here is what keeps a vendor from
   * publishing "₹500 per hour" for a three-day wedding and confusing everyone.
   */
  @Column({ type: 'jsonb', default: [] })
  allowedPricingModels: PricingModel[];

  @Column({ type: 'enum', enum: AvailabilityModel, default: AvailabilityModel.SLOT })
  availabilityModel: AvailabilityModel;

  /**
   * Whether a vendor may group offerings into packages.
   *
   * The specification is explicit that packages are optional: a priest sells
   * one ceremony, not a silver/gold/platinum tier, and forcing the concept on
   * them produces a listing nobody can read.
   */
  @Column({ default: true })
  packagesAllowed: boolean;

  /** Default capacity for a published window under this service. */
  @Column({ type: 'int', default: 1 })
  defaultCapacity: number;

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
