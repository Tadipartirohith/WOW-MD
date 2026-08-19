import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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

  /** Loads an event only if the caller is the host. */
  private async ownedEvent(userId: string, eventId: string): Promise<WeddingEvent> {
    const event = await this.events.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');
    if (event.userId !== userId) throw new ForbiddenException('This is not your event');
    return event;
  }

  /** Loads a guest only if the caller added them. */
  private async ownedGuest(userId: string, guestId: string): Promise<Guest> {
    const guest = await this.guests.findOne({ where: { id: guestId } });
    if (!guest) throw new NotFoundException('Guest not found');
    if (guest.userId !== userId) throw new ForbiddenException('This is not your guest');
    return guest;
  }

  async invite(userId: string, eventId: string, guestId: string) {
    await this.ownedEvent(userId, eventId);
    await this.ownedGuest(userId, guestId);

    const existing = await this.invites.findOne({ where: { eventId, guestId } });
    if (existing) return existing;
    return this.invites.save(this.invites.create({ eventId, guestId, status: RsvpStatus.INVITED }));
  }

  /**
   * Only the host may change an RSVP through this route. Guest-facing RSVP is a
   * separate, token-addressed flow (see the gap list in RBAC-AND-ROLES.md) so
   * that an invite id alone is never enough to mutate someone else's event.
   */
  async updateRsvp(userId: string, inviteId: string, dto: UpdateRsvpDto) {
    const invite = await this.invites.findOne({ where: { id: inviteId } });
    if (!invite) throw new NotFoundException('Invite not found');
    await this.ownedEvent(userId, invite.eventId);

    invite.status = dto.status;
    if (dto.seat !== undefined) invite.seat = dto.seat;
    return this.invites.save(invite);
  }

  /** RSVP + seating summary for an event the caller hosts. */
  async guestList(userId: string, eventId: string) {
    await this.ownedEvent(userId, eventId);
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
