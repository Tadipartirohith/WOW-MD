import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { ChatService } from '../chat/chat.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { BookingStatus, UserRole } from '../../common/enums';

/**
 * Bookings that can no longer be talked about.
 *
 * Written out rather than expressed as "not active", because the two reasons
 * are different and the vendor should be told which applies. A finished job's
 * thread is a record; a cancelled one never became a job at all.
 */
const CLOSED: BookingStatus[] = [BookingStatus.COMPLETED, BookingStatus.CANCELLED];

export interface BookingChatState {
  bookingId: string;
  /** Whether this account may send a message right now. */
  canSend: boolean;
  /** Whether the thread exists to be read at all. */
  open: boolean;
  /** Shown verbatim. The reason a locked thread is locked. */
  note: string;
  withUserId: string | null;
}

/**
 * Chat inside a booking, and the two rules that make it different from chat.
 *
 * It **opens when the advance is held**. Before that there is a quotation to
 * accept and a price to argue about, and both of those have their own screens
 * where what is said becomes part of the record. A chat thread opened at
 * enquiry time is where a vendor gets talked into a side deal off the platform.
 *
 * It **closes when the job does**, to reading only. What was agreed in the
 * thread — "bring the extra lighting", "we moved the muhurat by an hour" — is
 * exactly what somebody needs six weeks later when they are arguing about
 * whether it was delivered, so it is never deleted and never editable. A
 * completed booking with a live thread is one where the two parties settle
 * things in a channel the platform cannot act on; the dispute is where that
 * belongs, and it takes evidence.
 *
 * Authorization lives here rather than in the chat module because it is made
 * of payment state and job state, which are this module's, not chat's.
 */
@Injectable()
export class BookingChatService {
  constructor(
    private readonly bookings: BookingsService,
    private readonly chat: ChatService,
  ) {}

  /**
   * Where this booking's thread stands, for whoever is asking.
   *
   * Returned rather than inferred by the client, so the reason a box is
   * disabled is the same sentence the server would refuse with. A disabled box
   * with no explanation is how a vendor concludes the chat is broken.
   */
  async state(actor: AuthUser, bookingId: string): Promise<BookingChatState> {
    const booking = await this.bookings.forParticipant(actor, bookingId);
    const { buyerUserId, sellerUserId } = await this.bookings.counterparties(booking);
    const withUserId = actor.userId === buyerUserId ? sellerUserId : buyerUserId;

    if (CLOSED.includes(booking.status)) {
      return {
        bookingId,
        canSend: false,
        open: true,
        note:
          booking.status === BookingStatus.COMPLETED
            ? 'This job is finished. The conversation stays here to read; raise a dispute if something is wrong.'
            : 'This booking was cancelled. The conversation stays here to read.',
        withUserId,
      };
    }

    if (!(await this.bookings.advanceHeld(bookingId))) {
      return {
        bookingId,
        canSend: false,
        open: false,
        note: 'Chat opens once the advance is paid. Until then, everything is in the quotation.',
        withUserId,
      };
    }

    return { bookingId, canSend: true, open: true, note: 'Open.', withUserId };
  }

  /** The thread. Readable by either side whenever the booking is theirs. */
  async history(actor: AuthUser, bookingId: string, page: number, limit: number) {
    const booking = await this.bookings.forParticipant(actor, bookingId);
    const state = await this.state(actor, bookingId);
    if (!state.open) {
      // Nothing to hide — there is genuinely nothing there — but an empty list
      // and a locked box say different things, and the note says which.
      return { data: [], total: 0, page, limit, totalPages: 0, note: state.note };
    }
    const { buyerUserId, sellerUserId } = await this.bookings.counterparties(booking);
    const result = await this.chat.bookingHistory(bookingId, buyerUserId, sellerUserId, page, limit);
    return { ...result, note: state.note };
  }

  async send(actor: AuthUser, bookingId: string, body: string, mediaUrl?: string) {
    const booking = await this.bookings.forParticipant(actor, bookingId);
    const state = await this.state(actor, bookingId);

    // Enforced here, not by hiding the box. The rule is the point of the
    // feature, and a disabled input stops nobody who calls the API.
    if (!state.canSend) {
      throw state.open
        ? new ForbiddenException(state.note)
        : new BadRequestException(state.note);
    }

    const { buyerUserId, sellerUserId } = await this.bookings.counterparties(booking);
    const recipientId = actor.userId === buyerUserId ? sellerUserId : buyerUserId;
    // An administrator reading a booking is a participant for authorization and
    // not for conversation: there is no third seat in this thread.
    if (actor.role === UserRole.ADMIN && actor.userId !== buyerUserId && actor.userId !== sellerUserId) {
      throw new ForbiddenException('An administrator can read this thread but not write in it');
    }

    return this.chat.postToBookingThread(bookingId, actor.userId, recipientId, body, mediaUrl);
  }

  async markRead(actor: AuthUser, bookingId: string) {
    const booking = await this.bookings.forParticipant(actor, bookingId);
    const { buyerUserId, sellerUserId } = await this.bookings.counterparties(booking);
    const otherUserId = actor.userId === buyerUserId ? sellerUserId : buyerUserId;
    return this.chat.markBookingRead(bookingId, actor.userId, otherUserId);
  }
}
