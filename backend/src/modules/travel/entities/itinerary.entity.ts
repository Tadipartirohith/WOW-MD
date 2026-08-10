import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export interface ItineraryItem {
  day: number;
  title: string;
  notes?: string;
}

@Entity('itineraries')
export class Itinerary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column({ type: 'uuid', nullable: true })
  packageId: string | null;

  @Column()
  title: string;

  @Column({ type: 'jsonb', default: [] })
  items: ItineraryItem[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
