import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * One person deciding they do not want to hear from another.
 *
 * Deliberately one-directional and recorded per pair rather than as a flag on
 * an account: blocking is a decision *this* person made about *that* one, and
 * the other side must not be told. A blocked sender's messages are refused with
 * the same wording as any other closed conversation, because "you have been
 * blocked" turns a quiet exit into an argument.
 *
 * Reporting is separate and stored alongside. Blocking is between two people;
 * a report is a claim the platform has to look at, and somebody who blocks
 * usually does not want to write a report as well.
 */
@Entity('chat_blocks')
@Unique(['blockerUserId', 'blockedUserId'])
export class ChatBlock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  blockerUserId: string;

  @Index()
  @Column('uuid')
  blockedUserId: string;

  /** Kept for the blocker's own reference; never shown to the other side. */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/**
 * A report about somebody's conduct.
 *
 * Separate from a block because they answer different questions: a block is
 * "stop this", a report is "somebody should look at this". Kept even after the
 * reporter unblocks, since a pattern across several reporters is the thing that
 * matters and any one of them may change their mind.
 */
@Entity('chat_reports')
export class ChatReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  reporterUserId: string;

  @Index()
  @Column('uuid')
  reportedUserId: string;

  @Column({ type: 'varchar', length: 60 })
  reason: string;

  @Column({ type: 'text', nullable: true })
  detail: string | null;

  /**
   * The last few messages as they stood when the report was made.
   *
   * Copied rather than referenced: the point of evidence is that it does not
   * change afterwards, and a reported message the sender then edits or the
   * platform later redacts would leave an investigator with nothing.
   */
  @Column({ type: 'jsonb', default: [] })
  evidence: { at: string; fromMe: boolean; body: string }[];

  @Index()
  @Column({ type: 'boolean', default: false })
  reviewed: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
