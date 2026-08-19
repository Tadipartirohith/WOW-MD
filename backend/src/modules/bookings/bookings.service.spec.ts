import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';
import { Payment } from './entities/payment.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { AppConfigService } from '../../config/app-config.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { AgentsService } from '../agents/agents.service';
import { AuditService } from '../../platform/audit/audit.service';
import { PAYMENT_PROVIDER } from './payment.provider';
import { BookingStatus, ProviderType, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const asUser = (userId: string, role: UserRole): AuthUser => ({
  userId,
  email: `${userId}@example.com`,
  role,
  managedByAgentId: null,
});

describe('BookingsService', () => {
  let service: BookingsService;
  let current: Booking;

  // The vendor listing on every booking below is owned by 'vendor-owner'.
  const vendorsRepo = {
    findOne: jest.fn(async () => ({
      id: 'v1',
      ownerUserId: 'vendor-owner',
      isApproved: true,
    })),
    find: jest.fn(async () => [{ id: 'v1' }]),
  };
  const plannersRepo = { findOne: jest.fn(async () => null), find: jest.fn(async () => []) };
  const bookingsRepo = {
    findOne: jest.fn(async () => current),
    save: jest.fn(async (b) => {
      current = b as Booking;
      return current;
    }),
    create: jest.fn((x) => x),
    count: jest.fn(async () => 0),
  };
  const paymentsRepo = { findOne: jest.fn(async () => null), update: jest.fn() };
  const cfg = {
    payments: { currency: 'INR', provider: 'mock', commissionPercent: 10 },
  } as unknown as AppConfigService;
  const outbox = { record: jest.fn() } as unknown as OutboxService;
  const dataSource = {} as DataSource;
  const gateway = { createEscrowHold: jest.fn(), release: jest.fn(), refund: jest.fn() };
  const agents = {
    assertManages: jest.fn(async (agentId: string, clientId: string) => {
      if (agentId !== 'agent-1' || clientId !== 'client-1') {
        throw new ForbiddenException('That client is not on your books');
      }
      return { id: clientId };
    }),
  } as unknown as AgentsService;

  const baseBooking = (over: Partial<Booking> = {}): Booking =>
    ({
      id: 'b1',
      userId: 'u1',
      bookedByUserId: 'u1',
      providerType: ProviderType.VENDOR,
      providerId: 'v1',
      status: BookingStatus.CONFIRMED,
      ...over,
    }) as Booking;

  beforeEach(async () => {
    jest.clearAllMocks();
    current = baseBooking();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getRepositoryToken(Booking), useValue: bookingsRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentsRepo },
        { provide: getRepositoryToken(Vendor), useValue: vendorsRepo },
        { provide: getRepositoryToken(PlannerProfile), useValue: plannersRepo },
        { provide: AppConfigService, useValue: cfg },
        { provide: OutboxService, useValue: outbox },
        { provide: DataSource, useValue: dataSource },
        { provide: AgentsService, useValue: agents },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: PAYMENT_PROVIDER, useValue: gateway },
      ],
    }).compile();
    service = moduleRef.get(BookingsService);
  });

  describe('state machine', () => {
    it('allows a legal transition CONFIRMED to COMPLETED', async () => {
      const result = await service.complete(asUser('vendor-owner', UserRole.VENDOR), 'b1');
      expect(result.status).toBe(BookingStatus.COMPLETED);
    });

    it('rejects an illegal transition COMPLETED to CONFIRMED', async () => {
      current = baseBooking({ status: BookingStatus.COMPLETED });
      await expect(
        service.confirm(asUser('vendor-owner', UserRole.VENDOR), 'b1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects confirming an already-cancelled booking', async () => {
      current = baseBooking({ status: BookingStatus.CANCELLED });
      await expect(
        service.confirm(asUser('vendor-owner', UserRole.VENDOR), 'b1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('authorization', () => {
    // Previously complete() took only a booking id, so any authenticated user
    // could release another party's escrow by guessing a UUID.
    it('refuses to complete a booking against someone else’s listing', async () => {
      await expect(
        service.complete(asUser('random-user', UserRole.VENDOR), 'b1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to confirm a booking the caller does not own', async () => {
      current = baseBooking({ status: BookingStatus.PENDING });
      await expect(
        service.confirm(asUser('other-vendor', UserRole.VENDOR), 'b1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses to cancel a booking the caller is not party to', async () => {
      await expect(
        service.cancel(asUser('stranger', UserRole.BRIDE), 'b1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets the buyer cancel their own booking', async () => {
      const result = await service.cancel(asUser('u1', UserRole.BRIDE), 'b1', 'changed plans');
      expect(result.status).toBe(BookingStatus.CANCELLED);
    });

    it('lets the provider cancel a booking on their listing', async () => {
      const result = await service.cancel(asUser('vendor-owner', UserRole.VENDOR), 'b1');
      expect(result.status).toBe(BookingStatus.CANCELLED);
    });
  });

  describe('commission split', () => {
    // PAYMENT_COMMISSION_PERCENT used to be read into config and never applied,
    // so providers were paid the gross amount and the platform earned nothing.
    it('withholds the configured percentage from the payout', () => {
      const { commission, payout } = service.splitAmount('1000.00');
      expect(commission).toBe('100.00');
      expect(payout).toBe('900.00');
    });

    it('always sums back to exactly the amount held', () => {
      for (const amount of ['0.01', '33.33', '999.99', '12345.67']) {
        const { commission, payout } = service.splitAmount(amount);
        const total = (parseFloat(commission) + parseFloat(payout)).toFixed(2);
        expect(total).toBe(parseFloat(amount).toFixed(2));
      }
    });

    it('rounds in the seller favour, never overcharging commission', () => {
      const { commission } = service.splitAmount('0.05'); // 10% of 5 paise
      expect(parseFloat(commission)).toBeLessThanOrEqual(0.01);
    });
  });

  describe('agent on behalf of a client', () => {
    it('stamps both the client and the acting agent on the booking', async () => {
      const booking = await service.create(asUser('agent-1', UserRole.AGENT), {
        providerType: ProviderType.VENDOR,
        providerId: 'v1',
        amount: 1000,
        onBehalfOfUserId: 'client-1',
      });
      expect(booking.userId).toBe('client-1');
      expect(booking.bookedByUserId).toBe('agent-1');
    });

    it('refuses to book for a client the agent does not manage', async () => {
      await expect(
        service.create(asUser('agent-1', UserRole.AGENT), {
          providerType: ProviderType.VENDOR,
          providerId: 'v1',
          amount: 1000,
          onBehalfOfUserId: 'someone-elses-client',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses on-behalf-of booking from a non-agent account', async () => {
      await expect(
        service.create(asUser('u1', UserRole.BRIDE), {
          providerType: ProviderType.VENDOR,
          providerId: 'v1',
          amount: 1000,
          onBehalfOfUserId: 'client-1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a booking from a provider account', async () => {
      await expect(
        service.create(asUser('vendor-owner', UserRole.VENDOR), {
          providerType: ProviderType.VENDOR,
          providerId: 'v1',
          amount: 1000,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses a booking against an unapproved listing', async () => {
      vendorsRepo.findOne.mockResolvedValueOnce({
        id: 'v1',
        ownerUserId: 'vendor-owner',
        isApproved: false,
      });
      await expect(
        service.create(asUser('u1', UserRole.BRIDE), {
          providerType: ProviderType.VENDOR,
          providerId: 'v1',
          amount: 1000,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a self-booking', async () => {
      await expect(
        service.create(asUser('vendor-owner', UserRole.ADMIN), {
          providerType: ProviderType.VENDOR,
          providerId: 'v1',
          amount: 1000,
        }),
      ).rejects.toBeInstanceOf(Error);
    });
  });
});
