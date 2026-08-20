import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApplicantType, VerificationStatus } from '../../../common/enums';

/**
 * A request to verify an Agent or a Vendor before they get operational access.
 *
 * Registration creates the account in a restricted state and raises one of
 * these. An administrator allocates it to a verification officer, who visits,
 * checks the details and records a decision. Nothing about the applicant's
 * access changes until that decision lands — which is the whole point of the
 * gate.
 */
@Entity('verification_requests')
@Index(['applicantType', 'status'])
export class VerificationRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ApplicantType })
  applicantType: ApplicantType;

  /** The account being verified. */
  @Index()
  @Column('uuid')
  applicantUserId: string;

  /**
   * The agency or vendor record under review, when one exists. Null while the
   * applicant has registered but not yet filled in their business details.
   */
  @Column({ type: 'uuid', nullable: true })
  subjectId: string | null;

  @Index()
  @Column({ type: 'enum', enum: VerificationStatus, default: VerificationStatus.NEW })
  status: VerificationStatus;

  /** The verification officer this request is allocated to. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  assignedToUserId: string | null;

  @Column({ type: 'uuid', nullable: true })
  allocatedByUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  allocatedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  decidedByUserId: string | null;

  /**
   * Required on every outcome that is not an approval, so a rejected applicant
   * can always be told why and an auditor can see the reasoning.
   */
  @Column({ type: 'text', nullable: true })
  remarks: string | null;

  /** Free-form detail the officer recorded while investigating. */
  @Column({ type: 'jsonb', default: [] })
  history: { at: string; byUserId: string; status: string; remarks?: string }[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
