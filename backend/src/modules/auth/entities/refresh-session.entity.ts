import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * One row per signed-in device.
 *
 * Replaces the single `users.refreshTokenHash` column, which allowed exactly
 * one active session per account: signing in anywhere silently signed you out
 * everywhere else.
 *
 * Rotation: every refresh issues a new token and marks the old row replaced.
 * Presenting an already-replaced token means the token leaked, so the whole
 * family is revoked (`revokeFamily`) rather than just that row.
 */
@Entity('refresh_sessions')
export class RefreshSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  /** SHA-256 of the refresh token. The plaintext is never stored. */
  @Index({ unique: true })
  @Column()
  tokenHash: string;

  /**
   * Groups every rotation of one login together, so reuse detection can revoke
   * the entire chain in a single statement.
   */
  @Index()
  @Column('uuid')
  familyId: string;

  @Column({ type: 'varchar', length: 400, nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  revokedReason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
