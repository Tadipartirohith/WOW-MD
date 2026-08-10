import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';
import { Payment } from './entities/payment.entity';
import { AppConfigService } from '../../config/app-config.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { PAYMENT_PROVIDER } from './payment.provider';
import { BookingStatus } from '../../common/enums';

describe('BookingsService state machine', () => {
  let service: BookingsService;
  let current: Booking;

  const bookingsRepo = {
    findOne: jest.fn(async () => current),
    save: jest.fn(async (b) => {
      current = b as Booking;
      return current;
    }),
  };
  const paymentsRepo = { findOne: jest.fn(async () => null), update: jest.fn() };
  const cfg = { payments: { currency: 'INR', provider: 'mock' } } as unknown as AppConfigService;
  const outbox = { record: jest.fn() } as unknown as OutboxService;
  const dataSource = {} as DataSource;
  const gateway = { createEscrowHold: jest.fn(), release: jest.fn(), refund: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    current = { id: 'b1', userId: 'u1', status: BookingStatus.CONFIRMED } as Booking;
    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: bookingsRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentsRepo },
        { provide: AppConfigService, useValue: cfg },
        { provide: OutboxService, useValue: outbox },
        { provide: DataSource, useValue: dataSource },
        { provide: PAYMENT_PROVIDER, useValue: gateway },
      ],
    }).compile();
    service = moduleRef.get(BookingsService);
  });

  it('allows a legal transition CONFIRMED to COMPLETED', async () => {
    const result = await service.complete('b1');
    expect(result.status).toBe(BookingStatus.COMPLETED);
  });

  it('rejects an illegal transition COMPLETED to CONFIRMED', async () => {
    current = { id: 'b1', userId: 'u1', status: BookingStatus.COMPLETED } as Booking;
    await expect(service.confirm('b1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects confirming a already-cancelled booking', async () => {
    current = { id: 'b1', userId: 'u1', status: BookingStatus.CANCELLED } as Booking;
    await expect(service.confirm('b1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
