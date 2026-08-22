import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The top of the catalog: Photography, Catering, Priest, Transportation.
 *
 * Administrator-managed, because the alternative — letting every vendor invent
 * their own category — produces eleven spellings of "makeup artist" and a
 * search that finds none of them.
 */
@Entity('service_categories')
export class ServiceCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stable machine name. What a saved filter or a deep link refers to. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 60 })
  slug: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** An icon name the client resolves; the catalog does not ship images. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  icon: string | null;

  /**
   * Retiring a category hides it from new listings without breaking the
   * bookings already made under it. Categories are never deleted for that
   * reason.
   */
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
