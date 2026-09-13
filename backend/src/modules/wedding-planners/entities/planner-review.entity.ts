import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ReviewStatus } from '../../../common/enums';

/**
 * What somebody said about a wedding planner, and what has happened to it since.
 *
 * The vendor review, for the other kind of provider (EZ1-I244). Deliberately a
 * table of its own rather than a `providerType` column on the vendor one: the
 * two ratings hang off different listings, are recounted onto different rows,
 * and a shared table would put a planner's reviews one forgotten `where` clause
 * away from a vendor's average.
 *
 * Keyed on the booking rather than on the pair, for the reason that shape was
 * fixed on vendors: two completed weddings with the same planner are two
 * experiences and earn two reviews, and a (planner, user) key silently
 * overwrote the first with the second.
 */
@Entity('planner_reviews')
export class PlannerReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  plannerId: string;

  /**
   * Who wrote it.
   *
   * Never sent to the planner. A planner who knows which couple left three
   * stars is a planner who can take it up with them, and the prospect of that
   * conversation is what stops the next honest review being written.
   */
  @Column('uuid')
  userId: string;

  /** The completed booking it is about. One review per booking. */
  @Index({ unique: true, where: '"bookingId" IS NOT NULL' })
  @Column({ type: 'uuid', nullable: true })
  bookingId: string | null;

  @Column({ type: 'int' })
  rating: number; // 1-5

  @Column({ type: 'text', nullable: true })
  comment: string;

  /**
   * The optional per-part ratings: planning and coordination, communication,
   * service quality, professionalism, timeliness.
   *
   * A blob rather than five columns, because they are optional, they are read
   * together, and which parts a planner is judged on is a product decision that
   * will change before the schema should. The overall rating above is the one
   * the average is computed from and is never derived from these.
   */
  @Column({ type: 'jsonb', default: {} })
  categories: Record<string, number>;

  /**
   * Published unless something held it.
   *
   * Only `published` counts toward a planner's rating, so removing a review
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

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** The parts of the job a couple may rate separately. */
export const PLANNER_REVIEW_CATEGORIES = [
  'planning',
  'communication',
  'serviceQuality',
  'professionalism',
  'timeliness',
] as const;

export type PlannerReviewCategory = (typeof PLANNER_REVIEW_CATEGORIES)[number];
