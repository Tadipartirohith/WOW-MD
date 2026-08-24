import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { EventStatus } from '../../../common/enums';

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

  /** Mehendi, Sangeet, Reception — the family's own word for it. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  eventType: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  category: string | null;

  @Column({ type: 'text', nullable: true })
  venueAddress: string | null;

  @Index()
  @Column({ type: 'varchar', length: 120, nullable: true })
  city: string | null;

  /** 24-hour HH:MM. Null while the day is still "sometime in the evening". */
  @Column({ type: 'time', nullable: true })
  startTime: string | null;

  @Column({ type: 'time', nullable: true })
  endTime: string | null;

  /**
   * What the couple expect, as distinct from what the RSVPs say.
   *
   * Both matter and they are different numbers: the caterer is booked against
   * the expectation weeks before anybody has replied.
   */
  @Column({ type: 'int', nullable: true })
  expectedGuests: number | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  budget: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  imageUrl: string | null;

  @Index()
  @Column({ type: 'enum', enum: EventStatus, default: EventStatus.UPCOMING })
  status: EventStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
