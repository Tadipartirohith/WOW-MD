import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A profile kept for a second look.
 *
 * The step between "scrolled past" and "sent an interest" had nowhere to live.
 * Interest is a message to another family and cannot be taken back quietly, so
 * using it to mean "maybe" makes people either commit early or lose the
 * profile. A shortlist is private to the side that made it: the other family is
 * never told they are on one, which is the only reason it is useful.
 */
@Entity('profile_shortlists')
@Index('IDX_shortlist_pair', ['ownerProfileId', 'profileId'], { unique: true })
export class ProfileShortlist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Whose shortlist this is. */
  @Index()
  @Column('uuid')
  ownerProfileId: string;

  /** Who is on it. */
  @Column('uuid')
  profileId: string;

  /** Why they were kept — "same town as my sister", and so on. */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
