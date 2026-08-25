import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BookingChatService } from './booking-chat.service';
import { BookingsService } from './bookings.service';
import { ChatService } from '../chat/chat.service';
import { Booking } from './entities/booking.entity';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { BookingStatus, UserRole } from '../../common/enums';

const asUser = (userId: string, role: UserRole): AuthUser => ({
  userId,
  email: `${userId}@example.com`,
  role,
  managedByAgentId: null,
});

/**
 * The two rules that make a booking's thread different from a chat thread.
 *
 * Worth a unit test rather than only a live one because both are refusals, and
 * a refusal that silently stops refusing is the failure nobody notices: the
 * screen still works, the box is still there, and the rule is simply gone.
 */
describe('BookingChatService', () => {
  const booking = (over: Partial<Booking> = {}): Booking =>
    ({ id: 'b1', userId: 'buyer', status: BookingStatus.CONFIRMED, ...over }) as Booking;

  let current: Booking;
  let advanceHeld: boolean;
  const post = jest.fn(async () => ({ id: 'm1' }));

  const bookings = {
    forParticipant: jest.fn(async () => current),
    counterparties: jest.fn(async () => ({ buyerUserId: 'buyer', sellerUserId: 'seller' })),
    advanceHeld: jest.fn(async () => advanceHeld),
  } as unknown as BookingsService;

  const chat = {
    postToBookingThread: post,
    bookingHistory: jest.fn(async () => ({
      data: [{ id: 'm0' }],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    })),
    markBookingRead: jest.fn(async () => ({ marked: 0 })),
  } as unknown as ChatService;

  const service = new BookingChatService(bookings, chat);

  beforeEach(() => {
    jest.clearAllMocks();
    current = booking();
    advanceHeld = true;
  });

  it('refuses a message before the advance is held', async () => {
    advanceHeld = false;
    await expect(service.send(asUser('buyer', UserRole.BRIDE), 'b1', 'hello')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('opens once the advance is held', async () => {
    await service.send(asUser('buyer', UserRole.BRIDE), 'b1', 'hello');
    expect(post).toHaveBeenCalledWith('b1', 'buyer', 'seller', 'hello', undefined);
  });

  it('addresses the reply to the other side, whichever side is speaking', async () => {
    await service.send(asUser('seller', UserRole.VENDOR), 'b1', 'on my way');
    expect(post).toHaveBeenCalledWith('b1', 'seller', 'buyer', 'on my way', undefined);
  });

  it('stops taking messages once the job is finished', async () => {
    current = booking({ status: BookingStatus.COMPLETED });
    await expect(
      service.send(asUser('seller', UserRole.VENDOR), 'b1', 'one more thing'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(post).not.toHaveBeenCalled();
  });

  it('keeps a finished thread readable, which is the point of locking it', async () => {
    current = booking({ status: BookingStatus.COMPLETED });
    const state = await service.state(asUser('buyer', UserRole.BRIDE), 'b1');
    expect(state.canSend).toBe(false);
    expect(state.open).toBe(true);

    const history = await service.history(asUser('buyer', UserRole.BRIDE), 'b1', 1, 20);
    expect(history.total).toBe(1);
  });

  it('returns nothing to read on a thread that never opened', async () => {
    advanceHeld = false;
    const history = await service.history(asUser('buyer', UserRole.BRIDE), 'b1', 1, 20);
    expect(history.total).toBe(0);
    // The note is the same sentence a send would be refused with, so a disabled
    // box and the server always give the reader one explanation, not two.
    expect(history.note).toMatch(/advance/i);
  });

  it('lets an administrator read the thread but not write in it', async () => {
    await expect(
      service.send(asUser('an-admin', UserRole.ADMIN), 'b1', 'stepping in'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
