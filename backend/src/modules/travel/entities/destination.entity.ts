import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('destinations')
export class Destination {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Index()
  @Column({ nullable: true })
  country: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  imageUrl: string;

  @Column({ type: 'jsonb', default: [] })
  tags: string[];
}
