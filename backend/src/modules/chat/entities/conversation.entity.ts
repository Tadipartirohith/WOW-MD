import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('conversations')
@Unique(['participantA', 'participantB'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  participantA: string;

  @Index()
  @Column('uuid')
  participantB: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
