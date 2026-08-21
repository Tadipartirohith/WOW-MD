import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { FamilyAssetType } from '../../../common/enums';

/**
 * A family asset — a house, land, a commercial building.
 *
 * The most sensitive block on a profile, and the one most often asked about and
 * least often volunteered. It is never part of the public biodata, and
 * `visible` is opt-in per asset, so a family can disclose the house without
 * disclosing the farmland.
 */
@Entity('profile_assets')
export class ProfileAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  profileId: string;

  @Column({ type: 'enum', enum: FamilyAssetType })
  type: FamilyAssetType;

  @Column({ type: 'varchar', length: 160, nullable: true })
  location: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  area: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  estimatedValue: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  ownership: string | null;

  @Column({ type: 'text', nullable: true })
  remarks: string | null;

  /** Off unless the family says otherwise. */
  @Column({ type: 'boolean', default: false })
  visible: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
