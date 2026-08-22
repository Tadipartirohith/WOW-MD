import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { VendorCategory } from '../../../common/enums';

export interface VendorPricing {
  currency?: string;
  startingAt?: number;
  packages?: { name: string; price: number }[];
}

@Entity('vendors')
export class Vendor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  ownerUserId: string;

  @Column()
  name: string;

  @Index()
  @Column({ type: 'enum', enum: VendorCategory })
  category: VendorCategory;

  /** What the vendor actually does. Required when `category` is OTHER. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  otherCategory: string | null;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Index()
  @Column({ nullable: true })
  city: string;

  @Column({ type: 'jsonb', default: {} })
  pricing: VendorPricing;

  @Column({ type: 'jsonb', default: [] })
  portfolio: string[];

  @Column({ type: 'float', default: 0 })
  ratingAvg: number;

  @Column({ type: 'int', default: 0 })
  ratingCount: number;

  // ------------------------------------------------------------- compliance
  //
  // A wedding vendor invoices real money against real events, so the platform
  // holds the registration details it would need to answer for that: the GST
  // number it charges tax under, the PAN behind the business, and the address
  // the verification officer actually visits.

  @Index({ unique: true, where: '"gstNumber" IS NOT NULL' })
  @Column({ type: 'varchar', length: 15, nullable: true })
  gstNumber: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  panNumber: string | null;

  /** Company / firm registration number, where the business has one. */
  @Column({ type: 'varchar', nullable: true })
  registrationNumber: string | null;

  @Column({ type: 'text', nullable: true })
  registeredAddress: string | null;

  @Column({ type: 'varchar', nullable: true })
  contactPhone: string | null;

  /** Uploaded certificates and licences, as media URLs. */
  @Column({ type: 'jsonb', default: [] })
  complianceDocuments: string[];

  @Index()
  @Column({ default: false })
  isApproved: boolean;

  /**
   * The gateway's linked account for this business, once payout onboarding is done.
   *
   * Null is a normal state, not a missing value: a provider can take bookings
   * and complete work before their KYC clears. What it changes is that money
   * released from escrow stays there with a reason attached, rather than being
   * pushed at an account that does not exist.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  payoutAccountId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
