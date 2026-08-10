import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProfileVisibility } from '../../../common/enums';
import { User } from '../../auth/entities/user.entity';

export interface ProfilePreferences {
  religion?: string;
  community?: string;
  education?: string;
  lifestyle?: string[]; // e.g. ['non-smoker','vegetarian']
  preferredAgeMin?: number;
  preferredAgeMax?: number;
  preferredLocations?: string[];
}

@Entity('profiles')
export class Profile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column('uuid')
  userId: string;

  @OneToOne(() => User, (user) => user.profile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  displayName: string;

  @Index()
  @Column({ nullable: true })
  gender: string;

  @Column({ type: 'date', nullable: true })
  dateOfBirth: string | null;

  @Index()
  @Column({ nullable: true })
  city: string;

  @Column({ type: 'jsonb', default: {} })
  preferences: ProfilePreferences;

  @Column({ type: 'jsonb', default: [] })
  photos: string[];

  @Column({ type: 'text', nullable: true })
  bio: string;

  @Index()
  @Column({ type: 'enum', enum: ProfileVisibility, default: ProfileVisibility.MATCHES_ONLY })
  visibility: ProfileVisibility;

  @Column({ default: false })
  profileCompleted: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
