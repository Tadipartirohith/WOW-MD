import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../../../common/enums';
import { Profile } from '../../users/entities/profile.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column()
  email: string;

  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.BRIDE })
  role: UserRole;

  @Column({ default: false })
  isVerified: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  /** Soft disable: a steward can deactivate a client, admin can suspend anyone. */
  @Column({ default: true })
  isActive: boolean;

  /**
   * Set when an AGENT onboarded this account on the client's behalf. Null for
   * anyone who signed up directly; a self-registered user is never tied to an
   * agent and may approach any user or agent freely.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  managedByAgentId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'managedByAgentId' })
  managedByAgent: User | null;

  // ---- brute-force protection -------------------------------------------
  @Column({ type: 'int', default: 0 })
  failedLoginAttempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  // ---- two-factor (TOTP) -------------------------------------------------
  @Column({ default: false })
  mfaEnabled: boolean;

  /** Base32 TOTP secret. Never selected unless explicitly requested. */
  @Column({ type: 'varchar', nullable: true, select: false })
  mfaSecret: string | null;

  /**
   * Password changes invalidate every access token issued before this instant,
   * which is what makes "sign out everywhere" actually immediate.
   */
  @Column({ type: 'timestamptz', nullable: true })
  passwordChangedAt: Date | null;

  @OneToOne(() => Profile, (profile) => profile.user)
  profile: Profile;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
