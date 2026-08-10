import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WeddingEvent } from './entities/event.entity';
import { Guest } from './entities/guest.entity';
import { EventInvite } from './entities/event-invite.entity';
import { CreateEventDto, CreateGuestDto, UpdateRsvpDto } from './dto/event.dto';
import { RsvpStatus } from '../../common/enums';

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(WeddingEvent) private readonly events: Repository<WeddingEvent>,
    @InjectRepository(Guest) private readonly guests: Repository<Guest>,
    @InjectRepository(EventInvite) private readonly invites: Repository<EventInvite>,
  ) {}

  createEvent(userId: string, dto: CreateEventDto) {
    return this.events.save(this.events.create({ userId, ...dto }));
  }

  listEvents(userId: string) {
    return this.events.find({ where: { userId }, order: { eventDate: 'ASC' } });
  }

  addGuest(userId: string, dto: CreateGuestDto) {
    return this.guests.save(this.guests.create({ userId, ...dto }));
  }

  listGuests(userId: string) {
    return this.guests.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async invite(eventId: string, guestId: string) {
    const existing = await this.invites.findOne({ where: { eventId, guestId } });
    if (existing) return existing;
    return this.invites.save(this.invites.create({ eventId, guestId, status: RsvpStatus.INVITED }));
  }

  async updateRsvp(inviteId: string, dto: UpdateRsvpDto) {
    const invite = await this.invites.findOne({ where: { id: inviteId } });
    if (!invite) throw new NotFoundException('Invite not found');
    invite.status = dto.status;
    if (dto.seat !== undefined) invite.seat = dto.seat;
    return this.invites.save(invite);
  }

  /** RSVP + seating summary for an event. */
  async guestList(eventId: string) {
    const invites = await this.invites.find({ where: { eventId } });
    const summary = {
      total: invites.length,
      attending: invites.filter((i) => i.status === RsvpStatus.ATTENDING).length,
      declined: invites.filter((i) => i.status === RsvpStatus.DECLINED).length,
      pending: invites.filter((i) => i.status === RsvpStatus.INVITED).length,
    };
    return { summary, invites };
  }
}
