import { Test } from '@nestjs/testing';
import { WeddingEvent } from '../events/entities/event.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BookingsService } from './bookings.service';
import { Booking } from './entities/booking.entity';
import { Payment } from './entities/payment.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { Profile } from '../users/entities/profile.entity';
import { User } from '../auth/entities/user.entity';
import { AppConfigService } from '../../config/app-config.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { AgentsService } from '../agents/agents.service';
import { AuditService } from '../../platform/audit/audit.service';
import { SupportCasesService } from '../verification/support-cases.service';
import { MatchmakingService } from '../matchmaking/matchmaking.service';
import { AvailabilityService } from '../vendors/availability.service';
import { VendorServicesService } from '../catalog/vendor-services.service';
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
    // The duplicate-request check reads the buyer's live requests.
    find: jest.fn(async () => []),
    save: jest.fn(async (b) => {
      current = b as Booking;
      return current;
    }),
    create: jest.fn((x) => x),
    count: jest.fn(async () => 0),
  };
  const paymentsRepo = {
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    // The work gates ask "is this instalment held?"; each test says yes or no.
    count: jest.fn(async () => 1),
    update: jest.fn(),
  };

  // The buyer on these bookings is a matched individual with a completed
  // profile, so these tests stay about the state machine and the ownership
  // rules whichever way the services gate is set.
  // Nullable on purpose: one test hands back no profile at all, which is what a
  // buyer who never touched matchmaking looks like.
  type StubProfile = { id: string; userId: string; profileCompleted: boolean };
  const profilesRepo = {
    findOne: jest.fn(
      async (): Promise<StubProfile | null> => ({ id: 'p1', userId: 'u1', profileCompleted: true }),
    ),
  };
  const usersRepo = { findOne: jest.fn(async () => ({ id: 'u1', role: UserRole.BRIDE })) };
  const cases = { hasOpenCaseFor: jest.fn(async () => false) } as unknown as SupportCasesService;
  const matchmaking = { isMatchFixed: jest.fn(async () => true) } as unknown as MatchmakingService;
  const availability = {
    isBookable: jest.fn(async () => true),
    findSlot: jest.fn(async () => null),
    reserve: jest.fn(),
    confirm: jest.fn(),
    release: jest.fn(),
  } as unknown as AvailabilityService;
  // The catalog is what validates a buyer's answers against the form they were
  // generated from. These tests never send answers, so it is only here to
  // satisfy the constructor.
  const vendorServices = {
    validateBookingAnswers: jest.fn(async () => ({ service: { vendorId: 'v1' }, answers: {} })),
    findOffering: jest.fn(async () => null),
    findService: jest.fn(async () => null),
  } as unknown as VendorServicesService;
  const cfg = {
    payments: {
      currency: 'INR',
      provider: 'mock',
      commissionPercent: 10,
      milestonePercents: { advance: 30, second: 30, final: 40 },
    },
    // Mutable on purpose: the gate is a switch, and both of its positions are
    // worth a test.
    features: { servicesRequireMatchFixed: false },
  } as unknown as AppConfigService;
  const gate = (on: boolean) => {
    (cfg as unknown as { features: { servicesRequireMatchFixed: boolean } }).features
      .servicesRequireMatchFixed = on;
  };
  const outbox = { record: jest.fn() } as unknown as OutboxService;
  // confirm() takes the vendor's date inside a transaction, so the stub has to
  // hand back a manager that behaves like the booking repository.
  const dataSource = {
    transaction: jest.fn(async (fn: (m: unknown) => unknown) =>
      fn({ getRepository: () => bookingsRepo }),
    ),
  } as unknown as DataSource;
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
      amount: '5000.00',
      slotId: null,
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
        { provide: getRepositoryToken(Profile), useValue: profilesRepo },
        { provide: getRepositoryToken(User), useValue: usersRepo },
        // Read-only in the service: they put a client and a venue on a
        // provider's booking row, and nothing in these tests reads them.
        { provide: getRepositoryToken(WeddingEvent), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(VendorService), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: AppConfigService, useValue: cfg },
        { provide: OutboxService, useValue: outbox },
        { provide: DataSource, useValue: dataSource },
        { provide: AgentsService, useValue: agents },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: SupportCasesService, useValue: cases },
        { provide: MatchmakingService, useValue: matchmaking },
        { provide: AvailabilityService, useValue: availability },
        { provide: VendorServicesService, useValue: vendorServices },
        { provide: PAYMENT_PROVIDER, useValue: gateway },
      ],
    }).compile();
    service = moduleRef.get(BookingsService);
  });

  describe('state machine', () => {
    it('lets the provider mark work delivered once the second instalment is in', async () => {
      current = baseBooking({ status: BookingStatus.IN_PROGRESS });
      paymentsRepo.count.mockResolvedValueOnce(1);
      const result = await service.completeWork(asUser('vendor-owner', UserRole.VENDOR), 'b1');
      expect(result.status).toBe(BookingStatus.COMPLETED_PENDING_FINAL_PAYMENT);
    });

    it('refuses to mark work delivered before the second instalment', async () => {
      current = baseBooking({ status: BookingStatus.IN_PROGRESS });
      paymentsRepo.count.mockResolvedValueOnce(0);
      await expect(
        service.completeWork(asUser('vendor-owner', UserRole.VENDOR), 'b1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to start work before the advance is held', async () => {
      current = baseBooking({ status: BookingStatus.CONFIRMED });
      paymentsRepo.count.mockResolvedValueOnce(0);
      await expect(
        service.startWork(asUser('vendor-owner', UserRole.VENDOR), 'b1'),
      ).rejects.toBeInstanceOf(BadRequestException);
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
    it('refuses to mark work delivered on someone else’s listing', async () => {
      current = baseBooking({ status: BookingStatus.IN_PROGRESS });
      await expect(
        service.completeWork(asUser('random-user', UserRole.VENDOR), 'b1'),
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

  describe('who may place a booking', () => {
    it('refuses a booking from an agent account', async () => {
      // Narrowed deliberately: an agency introduces two families and is paid
      // for that. The couple hires their own vendors and holds their own
      // escrow, so there is no on-behalf path left to test.
      await expect(
        service.create(asUser('agent-1', UserRole.AGENT), {
          providerType: ProviderType.VENDOR,
          providerId: 'v1',
          amount: 1000,
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

  // The marketplace is open by default. Most matches are fixed at home, and one
  // of those is still a wedding that needs a caterer — the booking is where the
  // platform earns, so it is not held behind a funnel the buyer was never in.
  describe('the services gate', () => {
    afterEach(() => gate(false));

    it('takes a booking from a buyer whose match nobody has asked about', async () => {
      const booking = await service.create(asUser('u1', UserRole.BRIDE), {
        providerType: ProviderType.VENDOR,
        providerId: 'v1',
        amount: 1000,
      });

      expect(booking.status).toBe(BookingStatus.REQUESTED);
      // Asserted rather than stubbed: with the gate off nothing should go
      // looking for a profile or a match at all, so a buyer who has neither is
      // served for the same reason a buyer who has both is.
      expect(profilesRepo.findOne).not.toHaveBeenCalled();
      expect(matchmaking.isMatchFixed).not.toHaveBeenCalled();
    });

    it('still holds the door when an operator switches the gate back on', async () => {
      gate(true);
      (matchmaking.isMatchFixed as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.create(asUser('u1', UserRole.BRIDE), {
          providerType: ProviderType.VENDOR,
          providerId: 'v1',
          amount: 1000,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('never applies to an account with no matchmaking profile, gate or no gate', async () => {
      gate(true);
      usersRepo.findOne.mockResolvedValueOnce({ id: 'u1', role: UserRole.VENDOR });

      // A vendor account is refused for being a vendor, not for being unmatched:
      // the gate has nothing to say about accounts that never had a profile.
      await expect(
        service.create(asUser('u1', UserRole.VENDOR), {
          providerType: ProviderType.VENDOR,
          providerId: 'v1',
          amount: 1000,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(matchmaking.isMatchFixed).not.toHaveBeenCalled();
    });
  });
});
