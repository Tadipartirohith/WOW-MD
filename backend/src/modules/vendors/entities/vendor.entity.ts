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

  @Index()
  @Column({ default: false })
  isApproved: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
