import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('albums')
export class Album {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column()
  title: string;

  @Column({ default: false })
  isPublic: boolean;

  @Index({ unique: true })
  @Column()
  shareToken: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
