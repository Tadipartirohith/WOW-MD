import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('guests')
export class Guest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string; // the host who owns this guest record

  @Column()
  name: string;

  @Column({ nullable: true })
  contact: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
