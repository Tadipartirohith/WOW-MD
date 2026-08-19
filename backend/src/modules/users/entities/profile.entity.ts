import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NetworkVisibility, ProfileClaimStatus, ProfileVisibility } from '../../../common/enums';
import { User } from '../../auth/entities/user.entity';

export interface ProfilePreferences {
  religion?: string;
  community?: string;
  education?: string;
  lifestyle?: string[]; // e.g. ['non-smoker','vegetarian']
  preferredAgeMin?: number;
  preferredAgeMax?: number;
  preferredLocations?: string[];
}

/**
 * A marriage profile.
 *
 * A profile is NOT the same thing as an account. An agent or a family member
 * can build a complete profile — photos, preferences, contact details — for
 * somebody who has never signed up, and that profile is matchable straight
 * away. `userId` stays null until the subject accepts an invitation and claims
 * it, at which point they own it and the steward keeps read access.
 *
 * This is why matchmaking keys on profile ids rather than user ids.
 */
@Entity('profiles')
export class Profile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The account that owns this profile. Null while the profile is unclaimed. */
  @Index({ unique: true })
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  @OneToOne(() => User, (user) => user.profile, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  /**
   * The agent or family member who built and looks after this profile. Set for
   * steward-created profiles and retained after claiming, so the agency keeps
   * its book of business.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  managedByUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'managedByUserId' })
  managedBy: User | null;

  @Index()
  @Column({
    type: 'enum',
    enum: ProfileClaimStatus,
    default: ProfileClaimStatus.SELF,
  })
  claimStatus: ProfileClaimStatus;

  /**
   * Where an invitation would be sent, if the subject ever wants an account.
   * Optional on purpose: a family walking into an agency hands over a phone
   * number far more often than an email address, and plenty of clients never
   * want a login at all — the agent is their entire interface.
   *
   * Kept separate from `users.email`: the subject may claim with it and later
   * change their account email without breaking the agency's records.
   */
  @Column({ type: 'varchar', nullable: true })
  contactEmail: string | null;

  /**
   * The primary way to reach this person, and the practical identity key for a
   * walk-in client. Required when a steward builds the profile.
   */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  contactPhone: string | null;

  /**
   * Whether the wider vetted-agent network can find this profile. Moving to
   * POOL is circulation, so it requires live circulation consent.
   */
  @Index()
  @Column({ type: 'enum', enum: NetworkVisibility, default: NetworkVisibility.PRIVATE })
  networkVisibility: NetworkVisibility;

  @Column({ type: 'timestamptz', nullable: true })
  pooledAt: Date | null;

  @Column()
  displayName: string;

  @Index()
  @Column({ nullable: true })
  gender: string;

  @Column({ type: 'date', nullable: true })
  dateOfBirth: string | null;

  @Index()
  @Column({ nullable: true })
  city: string;

  @Column({ type: 'jsonb', default: {} })
  preferences: ProfilePreferences;

  @Column({ type: 'jsonb', default: [] })
  photos: string[];

  @Column({ type: 'text', nullable: true })
  bio: string;

  @Index()
  @Column({ type: 'enum', enum: ProfileVisibility, default: ProfileVisibility.MATCHES_ONLY })
  visibility: ProfileVisibility;

  @Column({ default: false })
  profileCompleted: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
