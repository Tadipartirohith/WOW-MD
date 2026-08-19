import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface PlannerPackage {
  name: string;
  price: number;
  includes?: string[];
}

/**
 * The public listing for a PLANNER account. Mirrors the vendor listing shape so
 * both provider personas are searchable and bookable through the same paths.
 */
@Entity('planner_profiles')
export class PlannerProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column('uuid')
  ownerUserId: string;

  @Column()
  agencyName: string;

  @Column({ type: 'text', nullable: true })
  bio: string;

  @Index()
  @Column({ nullable: true })
  city: string;

  @Column({ type: 'jsonb', default: [] })
  servesCities: string[];

  @Column({ type: 'jsonb', default: [] })
  packages: PlannerPackage[];

  @Column({ type: 'int', default: 0 })
  yearsExperience: number;

  @Column({ type: 'jsonb', default: [] })
  portfolio: string[];

  @Column({ type: 'float', default: 0 })
  ratingAvg: number;

  @Column({ type: 'int', default: 0 })
  ratingCount: number;

  @Index()
  @Column({ default: false })
  isApproved: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
