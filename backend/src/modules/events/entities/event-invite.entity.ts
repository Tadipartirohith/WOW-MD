import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { RsvpStatus } from '../../../common/enums';

@Entity('event_invites')
@Unique(['eventId', 'guestId'])
export class EventInvite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  eventId: string;

  @Index()
  @Column('uuid')
  guestId: string;

  @Column({ type: 'enum', enum: RsvpStatus, default: RsvpStatus.INVITED })
  status: RsvpStatus;

  @Column({ nullable: true })
  seat: string;

  /**
   * Guests are not platform users, so they answer through a signed link rather
   * than an authenticated route. Only the hash is stored; the plaintext lives
   * solely in the invitation that was sent.
   */
  @Index({ unique: true, where: '"rsvpTokenHash" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  rsvpTokenHash: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  rsvpTokenExpiresAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
