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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
