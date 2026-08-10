import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
