import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('events')
export class WeddingEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column()
  name: string; // e.g. Haldi, Mehendi, Reception

  @Column({ type: 'date', nullable: true })
  eventDate: string | null;

  @Column({ nullable: true })
  venue: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
