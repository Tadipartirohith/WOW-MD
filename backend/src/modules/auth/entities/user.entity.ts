import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
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

  @Column({ type: 'varchar', nullable: true, select: false })
  refreshTokenHash: string | null;

  @OneToOne(() => Profile, (profile) => profile.user)
  profile: Profile;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
