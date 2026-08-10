import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('messages')
@Index(['conversationId', 'createdAt'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  conversationId: string;

  @Index()
  @Column('uuid')
  senderId: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'varchar', nullable: true })
  mediaUrl: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
