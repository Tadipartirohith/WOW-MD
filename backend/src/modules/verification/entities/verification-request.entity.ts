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
/**
 * What an officer writes up after a visit.
 *
 * `verified` is the single question the decision turns on; everything else is
 * the evidence for it. `issues` is a list rather than prose so an administrator
 * sending the request back can point at one.
 */
export interface VerificationFindings {
  /** Did the officer confirm the business exists and is what it claims? */
  visited: boolean;
  /** What they saw. */
  observations: string;
  /** Anything that did not check out. Empty means nothing did. */
  issues: string[];
  /** Documents seen at the address, as media URLs. */
  evidence: string[];
  /** The officer's own recommendation. An administrator still decides. */
  recommendation: 'approve' | 'reject' | 'revisit';
}

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

  // ------------------------------------------------------------ the report
  //
  // What the officer actually found, kept apart from `remarks` because "what
  // did you see" and "why are you rejecting this" are different questions.
  // Collapsing them meant an approval carried no record of the visit at all.

  @Column({ type: 'jsonb', nullable: true })
  findings: VerificationFindings | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  submittedByUserId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewStartedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  reviewedByUserId: string | null;

  /**
   * What the automatic allocation went on.
   *
   * Recorded rather than inferred, because "nobody covers that city so it went
   * on workload alone" is a staffing gap an administrator should be able to
   * see, and it is invisible once the allocation has happened.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  allocationBasis: string | null;

  /** Where the applicant is, as it stood when the request was allocated. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  applicantCity: string | null;

  /**
   * Who and what, filled in when a queue is listed.
   *
   * Deliberately not columns, unlike applicantCity above — that one is stored
   * because it records where the applicant *was* when the request was
   * allocated, which is a fact about the allocation. These three are read from
   * the applicant's own records at display time, so a stored copy would go
   * stale the first time somebody renamed their business, and the queue would
   * then disagree with the record it is about.
   */
  applicantEmail?: string | null;
  applicantPhone?: string | null;
  subjectName?: string | null;

  /**
   * How many times this has been sent back for another look.
   *
   * Worth counting: a third visit usually means the request is unanswerable
   * rather than merely incomplete, and somebody should look at why.
   */
  @Column({ type: 'int', default: 0 })
  revisitCount: number;

  /**
   * When the platform has to be done by.
   *
   * The clock is about how long *we* take once we have been asked. A vendor
   * sitting on a draft for a month is not a breach; an unallocated request
   * sitting in a queue for four days is.
   */
  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  slaDeadline: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  slaBreachedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  verificationStartedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
