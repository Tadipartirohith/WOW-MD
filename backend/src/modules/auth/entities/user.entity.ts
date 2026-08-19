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

  @Column({ select: false })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.BRIDE })
  role: UserRole;

  @Column({ default: false })
  isVerified: boolean;

  /** Soft disable: an agent can deactivate a client, admin can suspend anyone. */
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

  @Column({ type: 'varchar', nullable: true, select: false })
  refreshTokenHash: string | null;

  @OneToOne(() => Profile, (profile) => profile.user)
  profile: Profile;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
