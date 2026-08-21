import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ClaimRequestStatus = 'pending' | 'approved' | 'declined';

/**
 * An agent asking somebody who already has an account to take the profile the
 * agent built for them.
 *
 * Without this, an agent whose client signed up on their own first was simply
 * stuck: the invitation is refused as a duplicate email and the work is
 * stranded on an unclaimed profile forever. The decision belongs to the person
 * whose profile it describes, never to the agent — which is why this is a
 * request rather than a transfer.
 */
@Entity('profile_claim_requests')
@Index(['targetUserId', 'status'])
export class ProfileClaimRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  profileId: string;

  @Column('uuid')
  requestedByUserId: string;

  /** The existing account the profile is believed to belong to. */
  @Column('uuid')
  targetUserId: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: ClaimRequestStatus;

  /** The agent's note: "we met at the Kukatpally office in March". */
  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
