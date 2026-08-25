import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A thread between two accounts.
 *
 * `bookingId` is what makes a conversation *about* something. A vendor with
 * three jobs for the same family needs three threads, not one where the
 * mandap and the mehendi are interleaved — and the rules differ per booking:
 * a thread opens when its advance is paid and stops accepting messages when
 * that job is done.
 *
 * The pair uniqueness is therefore scoped rather than absolute, and that is
 * done with two partial indexes rather than a plain unique on three columns:
 * NULLs do not collide in a Postgres unique index, so `(a, b, NULL)` would
 * permit any number of duplicate direct threads.
 */
@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  participantA: string;

  @Index()
  @Column('uuid')
  participantB: string;

  /**
   * The booking this thread is about, or null for a direct conversation.
   *
   * Two kinds of thread in one table, deliberately: they share redaction, read
   * receipts, reporting and the message store. What differs is who may open
   * one and when — and that is a gate, not a schema.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  bookingId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
