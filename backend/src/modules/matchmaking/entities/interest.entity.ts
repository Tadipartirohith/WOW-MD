import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { InterestStatus, MatchFixedState } from '../../../common/enums';

/**
 * An expression of interest between two *profiles*.
 *
 * Keyed on profile ids rather than user ids because a profile an agent built
 * is matchable before its subject has an account. `sentByUserId` records which
 * account actually clicked — the subject themselves, or the steward acting for
 * them — which keeps the audit trail honest.
 */
@Entity('interests')
@Unique(['fromProfileId', 'toProfileId'])
export class Interest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  fromProfileId: string;

  @Index()
  @Column('uuid')
  toProfileId: string;

  /** The account that performed the action. Null only for legacy rows. */
  @Column({ type: 'uuid', nullable: true })
  sentByUserId: string | null;

  /** The account that accepted or rejected, once answered. */
  @Column({ type: 'uuid', nullable: true })
  respondedByUserId: string | null;

  @Index()
  @Column({ type: 'enum', enum: InterestStatus, default: InterestStatus.PENDING })
  status: InterestStatus;

  /**
   * Fixing a match takes two confirmations, one from each side, because it is
   * the point at which real accounts get provisioned and matchmaking closes.
   * One side proposing is not enough.
   */
  @Index()
  @Column({ type: 'enum', enum: MatchFixedState, default: MatchFixedState.NONE })
  matchFixedState: MatchFixedState;

  /** Set when the side that owns `fromProfileId` confirms. */
  @Column({ type: 'timestamptz', nullable: true })
  fixedConfirmedFromAt: Date | null;

  /** Set when the side that owns `toProfileId` confirms. */
  @Column({ type: 'timestamptz', nullable: true })
  fixedConfirmedToAt: Date | null;

  /** Set once both confirmations are in. Provisioning keys off this. */
  @Column({ type: 'timestamptz', nullable: true })
  matchFixedAt: Date | null;

  /** Who ended it, for an unmatch or a block. */
  @Column({ type: 'uuid', nullable: true })
  endedByUserId: string | null;

  @Column({ type: 'text', nullable: true })
  endedReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
