import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { Notification } from './entities/notification.entity';
import { User } from '../auth/entities/user.entity';
import { PushService } from '../../platform/push/push.service';
import { WhatsAppService } from '../../platform/whatsapp/whatsapp.service';
import { NotificationType } from '../../common/enums';

/**
 * Who hears about a notification, and on what.
 *
 * The rules here are all refusals, and a refusal that quietly stops refusing is
 * the failure nobody notices — the feature still works, it just also messages
 * people who never asked to be messaged. Which, for WhatsApp, is what gets a
 * business number blocked.
 */
describe('NotificationsService delivery', () => {
  let service: NotificationsService;

  const saved = { id: '11111111-1111-4111-8111-111111111111' };
  const repo = {
    save: jest.fn(async (row) => ({ ...(row as object), ...saved })),
    create: jest.fn((x) => x),
  };

  let user: Partial<User> | null;
  const users = {
    findOne: jest.fn(async () => user),
    update: jest.fn(),
  };

  const push = { sendToUser: jest.fn(async () => ({ delivered: 1 })) };
  const whatsapp = { send: jest.fn(async () => true) };

  /** create() fans out without awaiting, so tests wait for the microtasks. */
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(async () => {
    jest.clearAllMocks();
    user = {
      id: 'u1',
      phone: '9876543210',
      whatsappOptIn: false,
      whatsappOptInAt: null,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(Notification), useValue: repo },
        { provide: getRepositoryToken(User), useValue: users },
        { provide: PushService, useValue: push },
        { provide: WhatsAppService, useValue: whatsapp },
      ],
    }).compile();
    service = moduleRef.get(NotificationsService);
  });

  it('stamps the destination from the type rather than from the caller', async () => {
    await service.create('u1', NotificationType.BOOKING_REQUEST, { bookingId: 'b-1' });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ targetModule: 'bookings', targetAction: 'respond' }),
    );
  });

  it('refuses a payload id that is not a uuid rather than losing the notification', async () => {
    // targetId is a uuid column, so a malformed value would fail the insert —
    // and a notification that throws on write is a notification nobody gets.
    await service.create('u1', NotificationType.NEW_MESSAGE, { fromUserId: 'not-a-uuid' });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ targetId: null }));
  });

  it('pushes to the recipient without being asked', async () => {
    await service.create('u1', NotificationType.BOOKING_REQUEST, { bookingId: 'b-1' });
    await settle();
    expect(push.sendToUser).toHaveBeenCalledWith(
      'u1',
      'New request',
      expect.stringContaining('asked about'),
      expect.objectContaining({ targetModule: 'bookings' }),
    );
  });

  it('sends nothing to WhatsApp without an opt-in', async () => {
    await service.create('u1', NotificationType.BOOKING_REQUEST, { bookingId: 'b-1' });
    await settle();
    expect(whatsapp.send).not.toHaveBeenCalled();
  });

  it('sends to WhatsApp once the account has asked for it', async () => {
    user = { id: 'u1', phone: '9876543210', whatsappOptIn: true, whatsappOptInAt: new Date() };
    await service.create('u1', NotificationType.BOOKING_REQUEST, {
      bookingId: 'b-1',
      clientName: 'The Rao family',
      service: 'Catering',
    });
    await settle();
    expect(whatsapp.send).toHaveBeenCalledWith(
      '9876543210',
      'booking_request',
      expect.arrayContaining(['The Rao family']),
    );
  });

  it('never sends a type with no approved template, opt-in or not', async () => {
    user = { id: 'u1', phone: '9876543210', whatsappOptIn: true, whatsappOptInAt: new Date() };
    // A matrimony message belongs in the app. There is no template for it, and
    // free text is refused by the API anyway.
    await service.create('u1', NotificationType.NEW_MESSAGE, {});
    await settle();
    expect(whatsapp.send).not.toHaveBeenCalled();
  });

  it('keeps the notification when a channel fails', async () => {
    push.sendToUser.mockRejectedValueOnce(new Error('firebase is down'));
    const row = await service.create('u1', NotificationType.BOOKING_PAYMENT, { bookingId: 'b-1' });
    await settle();
    expect(row.id).toBe(saved.id);
  });

  it('records when consent was given, and leaves it alone when it is withdrawn', async () => {
    await service.setWhatsApp('u1', true);
    expect(users.update).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ whatsappOptIn: true, whatsappOptInAt: expect.any(Date) }),
    );

    await service.setWhatsApp('u1', false);
    // "Did they agree, and when" still has an answer for somebody who later
    // changed their mind.
    expect(users.update).toHaveBeenLastCalledWith('u1', { whatsappOptIn: false });
  });
});
