import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** What a code was issued for. A code is only ever good for its own purpose. */
export enum PhoneCodePurpose {
  /** Proving the number on an account is real. */
  VERIFY = 'verify',
  /** Signing in with the number instead of a password (EZ1-I258). */
  LOGIN = 'login',
}

/**
 * An outstanding phone-verification code.
 *
 * The code is hashed, like every other credential here: a six-digit number in
 * plaintext is readable by anyone with a database, and it is the whole of the
 * proof being offered. `attempts` is what makes six digits defensible — a
 * million combinations is nothing to a script, but three guesses is.
 */
@Entity('phone_verifications')
export class PhoneVerification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  /** Captured at send time: changing the number invalidates the code. */
  @Column()
  phone: string;

  /**
   * What this code may be used for.
   *
   * A code sent to confirm a number must not sign anybody in, and a sign-in
   * code must not mark a number verified — they are issued in different
   * circumstances and prove different things. Stored rather than inferred, so
   * neither route can be made to accept the other's code (EZ1-I258).
   */
  @Index()
  @Column({ type: 'varchar', length: 16, default: PhoneCodePurpose.VERIFY })
  purpose: PhoneCodePurpose;

  @Column({ type: 'varchar', length: 64 })
  codeHash: string;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Index()
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
