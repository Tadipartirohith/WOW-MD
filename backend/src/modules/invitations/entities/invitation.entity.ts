import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { InvitationStatus } from '../../../common/enums';

/**
 * An invitation to claim a steward-built profile, by email, SMS or both.
 *
 * Only the SHA-256 of the token is stored, so a database leak does not hand an
 * attacker working invitation links. The plaintext exists exactly once, in the
 * email that goes out.
 */
@Entity('invitations')
export class Invitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  profileId: string;

  /**
   * Where the invite was sent, captured at send time.
   *
   * Nullable, because intake is phone-first: a walk-in family often gives a
   * number and nothing else, and the invitation goes out by SMS alone. The
   * address is then collected when they claim the account.
   */
  @Index()
  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Index({ unique: true })
  @Column()
  tokenHash: string;

  @Index()
  @Column({ type: 'enum', enum: InvitationStatus, default: InvitationStatus.PENDING })
  status: InvitationStatus;

  /** The steward who sent it. */
  @Index()
  @Column('uuid')
  invitedByUserId: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedAt: Date | null;

  /** The account created when the invitation was accepted. */
  @Column({ type: 'uuid', nullable: true })
  acceptedUserId: string | null;

  @Column({ type: 'int', default: 0 })
  resendCount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
