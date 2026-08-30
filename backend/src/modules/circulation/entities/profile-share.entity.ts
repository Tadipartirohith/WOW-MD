import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ShareAudience } from '../../../common/enums';

/**
 * One act of circulating a profile.
 *
 * This is the digital equivalent of handing a biodata sheet across a desk, and
 * it is deliberately a record rather than a flag: the agency needs to be able
 * to answer "who has seen my client's details?" and to take it back.
 *
 * A share grants READ ONLY. It never lets the recipient act as the profile,
 * edit it, or send interests from it — see ProfileAccessService.
 */
@Entity('profile_shares')
@Index(['profileId', 'audience'])
export class ProfileShare {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  profileId: string;

  /** The steward who circulated it. */
  @Index()
  @Column('uuid')
  sharedByUserId: string;

  @Column({ type: 'enum', enum: ShareAudience })
  audience: ShareAudience;

  /** Set for AGENT and USER shares; null for a link. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  recipientUserId: string | null;

  /**
   * Set for LINK shares. Only the SHA-256 is stored, so a database leak yields
   * no working links.
   */
  @Index({ unique: true, where: '"tokenHash" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  tokenHash: string | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'int', default: 0 })
  viewCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastViewedAt: Date | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  /**
   * The receiver said no thank you.
   *
   * Kept apart from `revokedAt`, which is the sharer withdrawing the share.
   * These are two different people making two different decisions, and the
   * sharing agency must never be able to see that the receiving agent
   * dismissed their client — so this is read on the receiver's screen and
   * nowhere else.
   */
  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  ignoredAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  ignoredByUserId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
