import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { InterestStatus } from '../../../common/enums';

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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
