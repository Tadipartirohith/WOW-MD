import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { MaritalStatus } from '../../../common/enums';

/**
 * One brother or sister.
 *
 * A row each rather than a JSON array, because siblings are added, edited and
 * removed one at a time — and an array means every edit rewrites the whole set,
 * which is how two people editing the same profile lose each other's changes.
 */
@Entity('profile_siblings')
export class ProfileSibling {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  profileId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'int', nullable: true })
  age: number | null;

  @Column({ type: 'enum', enum: MaritalStatus, nullable: true })
  maritalStatus: MaritalStatus | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  spouseName: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  qualification: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  profession: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
