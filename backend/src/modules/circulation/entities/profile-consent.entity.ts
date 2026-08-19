import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ConsentMethod, ConsentRelation, ConsentScope } from '../../../common/enums';

/**
 * A record of permission given for a profile the agency built.
 *
 * Append-only in practice: a re-confirmation writes a NEW row rather than
 * editing the old one, so there is always a history of what was agreed, by
 * whom, and when. Revocation sets `revokedAt` on the row rather than deleting.
 *
 * Two scopes, because they are different asks: INTAKE covers the agency holding
 * the details at all, CIRCULATION covers passing them outside the agency. A
 * walk-in family agreeing to the first has not agreed to the second.
 */
@Entity('profile_consents')
@Index(['profileId', 'scope'])
export class ProfileConsent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  profileId: string;

  @Column({ type: 'enum', enum: ConsentScope })
  scope: ConsentScope;

  @Column({ type: 'enum', enum: ConsentMethod })
  method: ConsentMethod;

  /** Who gave it: the subject themselves, or a parent/guardian on their behalf. */
  @Column({ type: 'enum', enum: ConsentRelation })
  givenByRelation: ConsentRelation;

  @Column()
  givenByName: string;

  /** The phone number the agency can call back to confirm, if one was given. */
  @Column({ type: 'varchar', nullable: true })
  givenByPhone: string | null;

  /** The date consent was actually given, which may predate this record. */
  @Column({ type: 'date' })
  givenAt: string;

  /** The agent who captured it. Answerable for the record. */
  @Index()
  @Column('uuid')
  capturedByUserId: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  /**
   * Circulation consent goes stale: after this instant the profile cannot be
   * shared again until the agent re-confirms with the family. Null for intake
   * consent, which does not expire.
   */
  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  revokedReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
