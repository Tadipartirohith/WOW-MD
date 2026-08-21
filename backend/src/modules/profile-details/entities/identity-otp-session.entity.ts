import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { OtpVerificationStatus } from '../../../common/enums';

/**
 * One Aadhaar OTP check.
 *
 * The Aadhaar number is not here, and neither is the OTP. The number lives on
 * the profile as a peppered hash; the code is stored the same way, so a leak of
 * this table yields nothing that can be replayed. What it does hold is the
 * shape of the attempt — when it was sent, how many tries have been made, when
 * it expires — which is what makes rate limiting and expiry enforceable.
 */
@Entity('identity_otp_sessions')
export class IdentityOtpSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  profileId: string;

  /** Who started it, for the audit trail. */
  @Column('uuid')
  requestedByUserId: string;

  /** The provider's own reference, for reconciliation and support. */
  @Column({ type: 'varchar', nullable: true })
  providerRef: string | null;

  /** SHA-256 of the code. Never the code. */
  @Column({ type: 'varchar', length: 64 })
  codeHash: string;

  @Column({ type: 'varchar', length: 4 })
  aadhaarLast4: string;

  @Index()
  @Column({ type: 'enum', enum: OtpVerificationStatus, default: OtpVerificationStatus.SENT })
  status: OtpVerificationStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
