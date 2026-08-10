import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('travel_packages')
export class TravelPackage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  destinationId: string;

  @Column()
  title: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  price: string;

  @Column({ type: 'int', default: 1 })
  nights: number;

  @Column({ type: 'jsonb', default: [] })
  inclusions: string[];
}
