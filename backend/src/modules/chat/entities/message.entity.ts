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

  /**
   * How many contact details were stripped from this message. A thread full of
   * non-zero counts is somebody repeatedly trying to take the conversation off
   * the platform, which is worth an investigator's attention.
   */
  @Column({ type: 'int', default: 0 })
  redactedCount: number;

  @Column({ type: 'varchar', nullable: true })
  mediaUrl: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
