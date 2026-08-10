import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { MediaType } from '../../../common/enums';

@Entity('media_items')
export class MediaItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  albumId: string;

  @Column()
  url: string;

  @Column({ type: 'enum', enum: MediaType, default: MediaType.IMAGE })
  type: MediaType;

  @Column({ nullable: true })
  caption: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
