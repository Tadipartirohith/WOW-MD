import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A message on a specific pairing.
 *
 * When two agents each hold one side of a possible match, the negotiation
 * happens between THEM, not between the two families. This hangs off the
 * existing interest record rather than introducing a parallel "proposal"
 * concept: an interest already is the pairing.
 *
 * Visible to whoever controls either profile — its owner, or its steward.
 */
@Entity('proposal_notes')
export class ProposalNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  interestId: string;

  @Index()
  @Column('uuid')
  authorUserId: string;

  /** Which side the author was writing for, for a readable transcript. */
  @Column('uuid')
  authorProfileId: string;

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
