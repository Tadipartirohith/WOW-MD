import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One person's settings for one conversation.
 *
 * Per viewer, not per conversation, and that is the whole reason this is a
 * table rather than two columns on `conversations`. Muting is one side deciding
 * they would rather not be interrupted; clearing is one side deciding they have
 * read enough. Neither is an instruction to the other person, and storing
 * either on the shared row would make it one.
 *
 * `clearedAt` is a watermark rather than a delete. Messages are what a dispute
 * is argued from and what a report is investigated with, so "clear this chat"
 * hides the history from the person who asked and destroys nothing — which is
 * also the honest reading of the request: they want their screen empty, not
 * the record gone.
 */
@Entity('chat_preferences')
@Unique(['userId', 'conversationId'])
export class ChatPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column('uuid')
  conversationId: string;

  /** No notifications from this thread. It still receives messages. */
  @Column({ default: false })
  muted: boolean;

  /**
   * Everything before this is hidden from this reader.
   *
   * Null means nothing is hidden. Set to now when they clear the chat, and
   * moved forward again each time they clear it since.
   */
  @Column({ type: 'timestamptz', nullable: true })
  clearedAt: Date | null;

  /**
   * Hidden from this reader's conversation list entirely.
   *
   * Distinct from clearing: clearing empties a thread you still have, deleting
   * removes it from the list. A new message brings it back, because the
   * alternative is a message nobody is ever shown.
   */
  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
