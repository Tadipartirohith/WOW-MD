import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * An agency's registration record.
 *
 * An agent account can sign in immediately, but cannot build profiles or
 * onboard clients until an administrator approves this record. Without that
 * gate anyone could self-register as an agent and start creating real accounts
 * for other people.
 */
@Entity('agent_profiles')
export class AgentProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column('uuid')
  ownerUserId: string;

  @Column()
  agencyName: string;

  @Column({ type: 'varchar', nullable: true })
  registrationNumber: string | null;

  @Column({ type: 'varchar', nullable: true })
  contactPhone: string | null;

  @Index()
  @Column({ nullable: true })
  city: string;

  /** Where the agency actually operates from. The officer visits this. */
  @Column({ type: 'text', nullable: true })
  address: string | null;

  /** When the agency started trading — a proxy for how established it is. */
  @Column({ type: 'date', nullable: true })
  startDate: string | null;

  /**
   * This agency's own profile-creation fee (EZ1-I128). Different agencies agree
   * different fees with their clients, so this overrides the platform default
   * (AGENT_PROFILE_FEE) when set. Null means "use the platform default".
   */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  profileCreationFee: string | null;

  /**
   * Photographs of the office. Optional on purpose: a small agency working out
   * of a front room should not be blocked from registering because it has
   * nothing photogenic to show.
   */
  @Column({ type: 'jsonb', default: [] })
  pictures: string[];

  @Column({ type: 'text', nullable: true })
  about: string;

  @Index()
  @Column({ default: false })
  isApproved: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  approvedByUserId: string | null;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string | null;

  /**
   * A standing sign-up link the agency hands out to bring on new clients
   * (EZ1-I166). Only the SHA-256 of the token is kept, so a leak cannot forge a
   * working link; the plaintext exists once, in the moment it is minted. Null
   * when no link is active — re-minting rotates it and withdrawing clears it.
   */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128, nullable: true })
  shareTokenHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  shareTokenCreatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
