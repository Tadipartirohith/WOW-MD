import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WeddingEvent } from './entities/event.entity';
import { Guest } from './entities/guest.entity';
import { EventInvite } from './entities/event-invite.entity';
import { Profile } from '../users/entities/profile.entity';
import { CreateEventDto, CreateGuestDto, GuestRsvpDto, UpdateRsvpDto } from './dto/event.dto';
import { RsvpStatus } from '../../common/enums';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../platform/mail/mail.service';
import { expiresIn, generateToken, hashToken } from '../../common/util/tokens';

/** What a guest sees on the public RSVP page. */
export interface GuestRsvpView {
  guestName: string;
  eventName: string;
  eventDate: string | null;
  venue: string | null;
  status: RsvpStatus;
  seat: string | null;
  respondedAt: Date | null;
}

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(WeddingEvent) private readonly events: Repository<WeddingEvent>,
    @InjectRepository(Guest) private readonly guests: Repository<Guest>,
    @InjectRepository(EventInvite) private readonly invites: Repository<EventInvite>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly cfg: AppConfigService,
    private readonly mail: MailService,
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

  /**
   * Invites a guest and issues their personal RSVP link.
   *
   * Guests are not platform users, so they answer through a signed, single-use
   * token rather than an authenticated route. The plaintext token is returned
   * to the host (so they can share it by hand) and emailed when the guest has
   * an email address on file; only its hash is stored.
   */
  async invite(userId: string, eventId: string, guestId: string) {
    const event = await this.ownedEvent(userId, eventId);
    const guest = await this.ownedGuest(userId, guestId);

    let invite = await this.invites.findOne({ where: { eventId, guestId } });
    if (!invite) {
      invite = this.invites.create({ eventId, guestId, status: RsvpStatus.INVITED });
    }

    const { token, tokenHash } = generateToken();
    invite.rsvpTokenHash = tokenHash;
    invite.rsvpTokenExpiresAt = expiresIn(this.cfg.auth.rsvpTokenTtlDays * 86_400);
    const saved = await this.invites.save(invite);

    if (guest.contact && guest.contact.includes('@')) {
      const hostProfile = await this.profiles.findOne({ where: { userId } });
      await this.mail.sendRsvpInvitation({
        to: guest.contact,
        guestName: guest.name,
        eventName: event.name,
        hostName: hostProfile?.displayName ?? 'Your host',
        token,
      });
    }

    return { invite: saved, rsvpToken: token, rsvpUrl: `/rsvp/${token}` };
  }

  /**
   * Host-side RSVP override, for when a guest replies by phone. The guest-facing
   * path is `respondByToken` below.
   */
  async updateRsvp(userId: string, inviteId: string, dto: UpdateRsvpDto) {
    const invite = await this.invites.findOne({ where: { id: inviteId } });
    if (!invite) throw new NotFoundException('Invite not found');
    await this.ownedEvent(userId, invite.eventId);

    invite.status = dto.status;
    if (dto.seat !== undefined) invite.seat = dto.seat;
    invite.respondedAt = new Date();
    return this.invites.save(invite);
  }

  private async inviteByToken(token: string): Promise<EventInvite> {
    const invite = await this.invites.findOne({ where: { rsvpTokenHash: hashToken(token) } });
    if (!invite) throw new NotFoundException('That invitation link is not valid');
    if (invite.rsvpTokenExpiresAt && invite.rsvpTokenExpiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('That invitation link has expired');
    }
    return invite;
  }

  /** Public: what the guest sees before answering. */
  async previewByToken(token: string): Promise<GuestRsvpView> {
    const invite = await this.inviteByToken(token);
    const [event, guest] = await Promise.all([
      this.events.findOne({ where: { id: invite.eventId } }),
      this.guests.findOne({ where: { id: invite.guestId } }),
    ]);
    if (!event || !guest) throw new NotFoundException('That invitation is no longer valid');

    return {
      guestName: guest.name,
      eventName: event.name,
      eventDate: event.eventDate ?? null,
      venue: event.venue ?? null,
      status: invite.status,
      seat: invite.seat ?? null,
      respondedAt: invite.respondedAt,
    };
  }

  /**
   * Public: the guest answers.
   *
   * The token stays valid until it expires so a guest can change their mind,
   * but it only ever addresses their own invite — it carries no authority over
   * the event or any other guest.
   */
  async respondByToken(token: string, dto: GuestRsvpDto): Promise<GuestRsvpView> {
    const invite = await this.inviteByToken(token);
    invite.status = dto.status;
    invite.respondedAt = new Date();
    await this.invites.save(invite);
    return this.previewByToken(token);
  }

  /** RSVP + seating summary for an event the caller hosts. */
  async guestList(userId: string, eventId: string) {
    await this.ownedEvent(userId, eventId);
    const invites = await this.invites.find({ where: { eventId } });
    const summary = {
      total: invites.length,
      attending: invites.filter((i) => i.status === RsvpStatus.ATTENDING).length,
      declined: invites.filter((i) => i.status === RsvpStatus.DECLINED).length,
      maybe: invites.filter((i) => i.status === RsvpStatus.MAYBE).length,
      pending: invites.filter((i) => i.status === RsvpStatus.INVITED).length,
    };
    // Never leak the token hashes to the client.
    const rows = invites.map(({ rsvpTokenHash, ...rest }) => {
      void rsvpTokenHash;
      return rest;
    });
    return { summary, invites: rows };
  }
}
