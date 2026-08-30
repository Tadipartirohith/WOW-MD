import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { WeddingEvent } from './entities/event.entity';
import { Guest } from './entities/guest.entity';
import { EventInvite } from './entities/event-invite.entity';
import { Profile } from '../users/entities/profile.entity';
import {
  CreateEventDto,
  CreateGuestDto,
  EventQueryDto,
  GuestRsvpDto,
  UpdateGuestDto,
  UpdateEventDto,
  UpdateRsvpDto,
} from './dto/event.dto';
import { Booking } from '../bookings/entities/booking.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { BookingStatus, EventStatus, RsvpStatus } from '../../common/enums';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../platform/mail/mail.service';
import { ModerationService } from '../../platform/moderation/moderation.service';
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
  /** What they said when they answered, so the page reads back their own reply. */
  attendingCount: number | null;
  declineReason: string | null;
  /** How many the invitation covers, which is what the head-count box defaults to. */
  invitedPartySize: number | null;
}

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(WeddingEvent) private readonly events: Repository<WeddingEvent>,
    @InjectRepository(Guest) private readonly guests: Repository<Guest>,
    @InjectRepository(EventInvite) private readonly invites: Repository<EventInvite>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    private readonly cfg: AppConfigService,
    private readonly mail: MailService,
    private readonly moderation: ModerationService,
  ) {}

  async createEvent(userId: string, dto: CreateEventDto) {
    this.assertTimeOrder(dto.startTime, dto.endTime);

    // An event picture is shown to every guest who opens the invitation, so it
    // goes through the same check as a profile photograph.
    if (dto.imageUrl) {
      await this.moderation.assertGenuinePhoto(dto.imageUrl, { userId, kind: 'event' });
    }
    return this.events.save(this.events.create({ userId, ...dto }));
  }

  /**
   * An evening that ends before it starts.
   *
   * The database refuses this too, and that check stays as the backstop — but
   * a constraint violation reaches the caller as a 500, which tells somebody
   * mistyping a time that the platform is broken. The rule belongs where it can
   * be explained.
   */
  private assertTimeOrder(start?: string | null, end?: string | null): void {
    if (!start || !end) return;
    if (end <= start) {
      throw new BadRequestException('The end time has to be after the start time');
    }
  }

  /**
   * The wedding, day by day.
   *
   * Filtering and searching happen here rather than in the client because the
   * list is the thing people scan, and a filter that only hides rows the
   * browser already has stops working the moment there are more days than one
   * page holds.
   */
  async listEvents(userId: string, q?: EventQueryDto) {
    const qb = this.events.createQueryBuilder('e').where('e."userId" = :userId', { userId });

    if (q?.status) qb.andWhere('e.status = :status', { status: q.status });
    if (q?.category) qb.andWhere('e.category = :category', { category: q.category });
    if (q?.q) {
      // Name, venue or city — the three things somebody remembers about a day
      // they are trying to find.
      qb.andWhere(
        '(LOWER(e.name) LIKE :term OR LOWER(COALESCE(e.venue, \'\')) LIKE :term OR LOWER(COALESCE(e.city, \'\')) LIKE :term)',
        { term: `%${q.q.toLowerCase()}%` },
      );
    }

    // Undated functions sort last rather than first: a day with no date yet is
    // the least urgent thing on the list, and NULLS FIRST puts it at the top.
    qb.orderBy('e."eventDate"', 'ASC', 'NULLS LAST').addOrderBy('e."startTime"', 'ASC', 'NULLS LAST');
    const rows = await qb.getMany();
    if (rows.length === 0) return rows;

    /*
     * RSVP counts on every day, not only the one that happens to be selected.
     *
     * "How many are coming to the sangeet" was answerable in exactly one place:
     * click the day, then read the panel. So the answer to "where are we with
     * the wedding" took as many clicks as there were days, and the page that
     * was supposed to summarise it summarised nothing.
     *
     * One query for every invitation across every day, counted in memory. The
     * alternative is a correlated subquery per event, which is the same work
     * done once per row.
     */
    const invites = await this.invites.find({ where: { eventId: In(rows.map((e) => e.id)) } });
    const byEvent = new Map<string, { coming: number; notComing: number; noReply: number }>();
    for (const event of rows) byEvent.set(event.id, { coming: 0, notComing: 0, noReply: 0 });

    for (const invite of invites) {
      const tally = byEvent.get(invite.eventId);
      if (!tally) continue;
      if (invite.status === RsvpStatus.ATTENDING) tally.coming += 1;
      else if (invite.status === RsvpStatus.DECLINED) tally.notComing += 1;
      // "Maybe" counts as not yet answered, because for a caterer it is.
      else tally.noReply += 1;
    }

    return rows.map((event) => ({ ...event, rsvp: byEvent.get(event.id) }));
  }

  /**
   * The counters above the list.
   *
   * Computed from the rows rather than maintained, so they cannot drift from
   * what the list below them shows — which is the failure that makes somebody
   * stop believing a summary.
   */
  async eventSummary(userId: string) {
    const rows = await this.events.find({ where: { userId } });
    const invites = rows.length
      ? await this.invites.find({ where: { eventId: In(rows.map((e) => e.id)) } })
      : [];

    const count = (status: EventStatus) => rows.filter((e) => e.status === status).length;
    return {
      total: rows.length,
      upcoming: count(EventStatus.UPCOMING),
      ongoing: count(EventStatus.ONGOING),
      completed: count(EventStatus.COMPLETED),
      cancelled: count(EventStatus.CANCELLED),
      /** Across every day — the number the caterer for the whole wedding asks for. */
      confirmedGuests: invites.filter((i) => i.status === RsvpStatus.ATTENDING).length,
      expectedGuests: rows.reduce((n, e) => n + (e.expectedGuests ?? 0), 0),
      budget: rows
        .reduce((n, e) => n + Number(e.budget ?? 0), 0)
        .toFixed(2),
    };
  }

  async updateEvent(userId: string, eventId: string, dto: UpdateEventDto) {
    const event = await this.ownedEvent(userId, eventId);
    this.assertTimeOrder(
      dto.startTime ?? event.startTime,
      dto.endTime ?? event.endTime,
    );
    Object.assign(event, dto);
    return this.events.save(event);
  }

  /**
   * Removes an event.
   *
   * Refused while vendors are booked against it. Deleting the mehendi out from
   * under a confirmed makeup artist would leave a live booking pointing at
   * nothing, and the couple would find out when somebody failed to arrive.
   */
  async removeEvent(userId: string, eventId: string) {
    await this.ownedEvent(userId, eventId);

    const booked = await this.bookings.count({
      where: { eventId, status: Not(BookingStatus.CANCELLED) },
    });
    if (booked > 0) {
      throw new BadRequestException(
        'Cancel the vendors booked for this event before removing it',
      );
    }

    await this.invites.delete({ eventId });
    await this.events.delete({ id: eventId });
    return { success: true };
  }

  /** Who is booked for this event, so the couple can see the day as a whole. */
  async eventVendors(userId: string, eventId: string) {
    await this.ownedEvent(userId, eventId);
    const bookings = await this.bookings.find({
      where: { eventId },
      order: { createdAt: 'DESC' },
    });
    if (bookings.length === 0) return [];

    const vendors = await this.vendors.find({
      where: { id: In(bookings.map((b) => b.providerId)) },
    });
    const byId = new Map(vendors.map((v) => [v.id, v]));

    return bookings.map((b) => ({
      bookingId: b.id,
      status: b.status,
      amount: b.amount,
      providerId: b.providerId,
      providerType: b.providerType,
      providerName: byId.get(b.providerId)?.name ?? 'Provider',
      category: byId.get(b.providerId)?.category ?? null,
    }));
  }

  addGuest(userId: string, dto: CreateGuestDto) {
    return this.guests.save(this.guests.create({ userId, ...dto }));
  }

  /**
   * Correcting a guest record.
   *
   * Worth having on its own because the head count and the mobile number are
   * exactly the two things that turn out to be wrong on the day somebody starts
   * chasing RSVPs, and re-creating the guest would lose their invitation.
   */
  async updateGuest(userId: string, guestId: string, dto: UpdateGuestDto) {
    const guest = await this.ownedGuest(userId, guestId);
    Object.assign(guest, dto);
    return this.guests.save(guest);
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

    this.applyRsvp(invite, dto.status, dto.attendingCount, dto.declineReason);
    if (dto.seat !== undefined) invite.seat = dto.seat;
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
      attendingCount: invite.attendingCount,
      declineReason: invite.declineReason,
      invitedPartySize: guest.partySize,
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
    this.applyRsvp(invite, dto.status, dto.attendingCount, dto.declineReason);
    await this.invites.save(invite);
    return this.previewByToken(token);
  }

  /**
   * The one place an RSVP is written, wherever it came from.
   *
   * Two rules that are easy to get wrong separately and impossible to get wrong
   * here: a refusal carries no head count, and changing your mind from "not
   * coming" back to "coming" clears the reason you gave for the refusal — it is
   * no longer true, and leaving it on the record makes the organiser's list
   * read as though it still is.
   */
  private applyRsvp(
    invite: EventInvite,
    status: RsvpStatus,
    attendingCount?: number,
    declineReason?: string,
  ): void {
    invite.status = status;
    invite.respondedAt = new Date();

    if (status === RsvpStatus.DECLINED) {
      invite.attendingCount = 0;
      if (declineReason !== undefined) invite.declineReason = declineReason || null;
    } else {
      invite.declineReason = null;
      if (attendingCount !== undefined) invite.attendingCount = attendingCount;
    }
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

  // ------------------------------------------------------------------ RSVP

  /**
   * The numbers an organiser plans from.
   *
   * Two head counts, not one. `invitations` is how many invitations are in each
   * state; `people` is how many human beings that comes to, because an
   * invitation goes to a family and the caterer counts heads. The gap between
   * invited and attending is the thing worth chasing.
   *
   * "Maybe" is reported on its own rather than folded into either side.
   * Somebody who answered "probably" has answered, and counting them as
   * unresponsive sends them a reminder they have already replied to.
   */
  async rsvpDashboard(userId: string, eventId: string) {
    const event = await this.ownedEvent(userId, eventId);
    const invites = await this.invites.find({ where: { eventId } });
    const guests = await this.guestsFor(invites);

    // How many people an invitation covers: what they said when they answered,
    // otherwise how many were invited, otherwise one.
    const heads = (i: EventInvite) =>
      i.attendingCount ?? guests.get(i.guestId)?.partySize ?? 1;
    const sum = (rows: EventInvite[]) => rows.reduce((n, i) => n + heads(i), 0);

    const of = (status: RsvpStatus) => invites.filter((i) => i.status === status);
    const coming = of(RsvpStatus.ATTENDING);
    const notComing = of(RsvpStatus.DECLINED);
    const maybe = of(RsvpStatus.MAYBE);
    const notResponded = of(RsvpStatus.INVITED);

    const WEEK = 7 * 24 * 60 * 60 * 1000;

    return {
      event: { id: event.id, name: event.name, eventDate: event.eventDate, venue: event.venue },
      totalInvited: invites.length,
      totalInvitedHeadcount: invites.reduce(
        (n, i) => n + (guests.get(i.guestId)?.partySize ?? 1),
        0,
      ),
      categories: {
        coming: { invitations: coming.length, people: sum(coming) },
        // Nobody is coming from a refusal, whatever the family size.
        notComing: { invitations: notComing.length, people: 0 },
        maybe: { invitations: maybe.length, people: sum(maybe) },
        notResponded: { invitations: notResponded.length, people: sum(notResponded) },
      },
      /** Not chased yet, or not for a week. */
      awaitingReminder: notResponded.filter(
        (i) => !i.lastRemindedAt || Date.now() - i.lastRemindedAt.getTime() > WEEK,
      ).length,
    };
  }

  /**
   * The guests behind one number on the dashboard.
   *
   * Every category returns the same row shape, carrying the fields that
   * category's follow-up needs: a head count for the people coming, a reason
   * for those who cannot, and a last-reminded date for those who have not said
   * — because the point of a "not responded" list is knowing who has already
   * been asked twice.
   */
  async rsvpGuests(userId: string, eventId: string, category: string) {
    await this.ownedEvent(userId, eventId);

    const wanted: Record<string, RsvpStatus | null> = {
      coming: RsvpStatus.ATTENDING,
      not_coming: RsvpStatus.DECLINED,
      maybe: RsvpStatus.MAYBE,
      not_responded: RsvpStatus.INVITED,
      all: null,
    };
    if (!(category in wanted)) {
      throw new BadRequestException(
        'Ask for coming, not_coming, maybe, not_responded or all',
      );
    }
    const status = wanted[category];

    const invites = await this.invites.find({
      where: status === null ? { eventId } : { eventId, status },
      order: { updatedAt: 'DESC' },
    });
    const guests = await this.guestsFor(invites);

    return invites.map((invite) => {
      const guest = guests.get(invite.guestId);
      return {
        inviteId: invite.id,
        guestId: invite.guestId,
        name: guest?.name ?? 'Guest',
        phone: guest?.phone ?? null,
        email: guest?.contact ?? null,
        relation: guest?.relation ?? null,
        invitedPartySize: guest?.partySize ?? null,
        status: invite.status,
        attendingCount: invite.attendingCount,
        respondedAt: invite.respondedAt,
        declineReason: invite.declineReason,
        // Whether the invitation ever actually went out, which is a different
        // question from whether they answered it.
        invitationSent: invite.rsvpTokenHash !== null,
        lastRemindedAt: invite.lastRemindedAt,
        reminderCount: invite.reminderCount,
        seat: invite.seat,
      };
    });
  }

  /**
   * Records that somebody has been chased.
   *
   * The reminder only goes out by email if there is an address; the record is
   * kept either way, because an organiser who rang them still needs the list to
   * say so. A fresh token is issued with it, since the plaintext one only ever
   * existed inside the original invitation.
   */
  async remind(userId: string, inviteId: string) {
    const invite = await this.invites.findOne({ where: { id: inviteId } });
    if (!invite) throw new NotFoundException('Invite not found');
    const event = await this.ownedEvent(userId, invite.eventId);

    if (invite.status !== RsvpStatus.INVITED) {
      throw new BadRequestException('They have already answered');
    }

    const guest = await this.guests.findOne({ where: { id: invite.guestId } });
    invite.lastRemindedAt = new Date();
    invite.reminderCount += 1;

    let emailSent = false;
    if (guest?.contact && guest.contact.includes('@')) {
      const { token, tokenHash } = generateToken();
      invite.rsvpTokenHash = tokenHash;
      invite.rsvpTokenExpiresAt = expiresIn(this.cfg.auth.rsvpTokenTtlDays * 86_400);
      const hostProfile = await this.profiles.findOne({ where: { userId } });
      await this.mail.sendRsvpInvitation({
        to: guest.contact,
        guestName: guest.name,
        eventName: event.name,
        hostName: hostProfile?.displayName ?? 'Your host',
        token,
      });
      emailSent = true;
    }

    const saved = await this.invites.save(invite);
    return {
      inviteId: saved.id,
      lastRemindedAt: saved.lastRemindedAt,
      reminderCount: saved.reminderCount,
      emailSent,
    };
  }

  private async guestsFor(invites: EventInvite[]): Promise<Map<string, Guest>> {
    if (invites.length === 0) return new Map();
    const rows = await this.guests.find({ where: { id: In(invites.map((i) => i.guestId)) } });
    return new Map(rows.map((g) => [g.id, g]));
  }
}
