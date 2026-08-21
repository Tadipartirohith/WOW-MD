import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

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
