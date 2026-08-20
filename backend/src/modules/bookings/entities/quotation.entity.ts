import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { QuotationStatus } from '../../../common/enums';

export interface QuotationLine {
  description: string;
  amount: number;
}

/**
 * A priced offer against a booking request.
 *
 * Quotations are never edited in place. Re-pricing supersedes the previous one
 * and leaves it on the record, so what was offered, when, and at what price is
 * always reconstructable — which is exactly what a later dispute turns on.
 */
@Entity('quotations')
export class Quotation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  bookingId: string;

  /** The provider account that issued it. */
  @Index()
  @Column('uuid')
  issuedByUserId: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;

  @Column({ default: 'INR' })
  currency: string;

  /** Line items, so the buyer can see what they are paying for. */
  @Column({ type: 'jsonb', default: [] })
  lines: QuotationLine[];

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /** After this date the offer lapses and has to be re-issued. */
  @Column({ type: 'timestamptz', nullable: true })
  validUntil: Date | null;

  @Index()
  @Column({ type: 'enum', enum: QuotationStatus, default: QuotationStatus.SENT })
  status: QuotationStatus;

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
