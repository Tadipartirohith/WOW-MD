import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ReviewStatus } from '../../../common/enums';

/**
 * What somebody said about a vendor, and what has happened to it since.
 *
 * The uniqueness moved from (vendor, user) to the booking. One review per
 * customer per vendor sounds right and is not: two completed jobs with the
 * same vendor are two experiences, and the old shape silently overwrote the
 * first review with the second — via upsert, so nothing failed and the rating
 * count never moved.
 */
@Entity('vendor_reviews')
export class VendorReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  vendorId: string;

  /**
   * Who wrote it.
   *
   * Never sent to the vendor. A vendor who knows which customer left three
   * stars is a vendor who can take it up with them, and the prospect of that
   * conversation is what stops the next honest review being written.
   */
  @Column('uuid')
  userId: string;

  /** The completed job it is about. Null on rows written before this existed. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  bookingId: string | null;

  @Column({ type: 'int' })
  rating: number; // 1-5

  @Column({ type: 'text', nullable: true })
  comment: string;

  /**
   * Published unless something held it.
   *
   * Only `published` counts toward a vendor's rating, so removing a review
   * moves the average — which is the point of removing it.
   */
  @Index()
  @Column({ type: 'enum', enum: ReviewStatus, default: ReviewStatus.PUBLISHED })
  status: ReviewStatus;

  /** Why it was held, flagged or taken down. Shown to whoever looks next. */
  @Column({ type: 'text', nullable: true })
  moderationReason: string | null;

  @Column({ type: 'uuid', nullable: true })
  moderatedByUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  moderatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
