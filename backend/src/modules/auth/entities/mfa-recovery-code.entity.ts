import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A single-use way back in when the authenticator is gone.
 *
 * bcrypt rather than a fast hash: a recovery code is as good as a password and
 * the alphabet is short enough that SHA-256 over the whole space is minutes of
 * GPU time. Used codes are kept rather than deleted, so "somebody used a
 * recovery code last Tuesday" stays answerable.
 */
@Entity('mfa_recovery_codes')
export class MfaRecoveryCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 120 })
  codeHash: string;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
