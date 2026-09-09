import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WeddingDashboardService } from './wedding-dashboard.service';
import { WeddingPlan } from './entities/wedding-plan.entity';
import { PlanTask } from './entities/plan-task.entity';
import { WeddingEvent } from '../events/entities/event.entity';
import { Guest } from '../events/entities/guest.entity';
import { EventInvite } from '../events/entities/event-invite.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { BookingStatus, PaymentStatus, ProviderType, TaskStatus } from '../../common/enums';

const iso = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

/**
 * plannerOverview is the dashboard's contract with My Clients: the numbers on
 * the dashboard are the numbers on the list, off the same plannerUserId source.
 * These lock in the invariants EZ1-I184 set out to guarantee.
 */
describe('WeddingDashboardService.plannerOverview', () => {
  const repos = {
    plans: { find: jest.fn(), findOne: jest.fn() },
    tasks: { find: jest.fn() },
    events: { find: jest.fn(async () => []) },
    guests: { find: jest.fn(async () => []) },
    invites: { find: jest.fn(async () => []) },
    bookings: { find: jest.fn() },
    vendors: { find: jest.fn(async () => []) },
    payments: { find: jest.fn() },
    plannerProfiles: { find: jest.fn() },
  };
  let service: WeddingDashboardService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        WeddingDashboardService,
        { provide: getRepositoryToken(WeddingPlan), useValue: repos.plans },
        { provide: getRepositoryToken(PlanTask), useValue: repos.tasks },
        { provide: getRepositoryToken(WeddingEvent), useValue: repos.events },
        { provide: getRepositoryToken(Guest), useValue: repos.guests },
        { provide: getRepositoryToken(EventInvite), useValue: repos.invites },
        { provide: getRepositoryToken(Booking), useValue: repos.bookings },
        { provide: getRepositoryToken(Payment), useValue: repos.payments },
        { provide: getRepositoryToken(PlannerProfile), useValue: repos.plannerProfiles },
        { provide: getRepositoryToken(Vendor), useValue: repos.vendors },
      ],
    }).compile();
    service = moduleRef.get(WeddingDashboardService);
  });

  it('is zero across the board when the planner has no engaged weddings', async () => {
    repos.plans.find.mockResolvedValue([]);

    const out = await service.plannerOverview('planner-1');

    expect(out).toMatchObject({
      weddings: 0,
      active: 0,
      upcoming: 0,
      completed: 0,
      clients: 0,
      bookings: { total: 0, confirmed: 0, pending: 0 },
      escrowHeld: '0.00',
      tasks: { total: 0, done: 0, overdue: 0 },
    });
    // No book means no further reads — nothing to borrow a stray figure from.
    expect(repos.payments.find).not.toHaveBeenCalled();
  });

  it('derives every figure from the engaged plans, their bookings and tasks', async () => {
    // Two weddings: one still to come and worked on (active), one already past
    // (completed). Same lifecycle rule PlannerClientsService uses.
    repos.plans.find.mockResolvedValue([
      { id: 'planA', userId: 'clientA', weddingDate: iso(30) },
      { id: 'planB', userId: 'clientB', weddingDate: iso(-30) },
    ]);
    repos.tasks.find.mockResolvedValue([
      { planId: 'planA', status: TaskStatus.IN_PROGRESS, dueDate: iso(10) }, // started -> active, not overdue
      { planId: 'planA', status: TaskStatus.PENDING, dueDate: iso(-5) }, // genuinely overdue
      { planId: 'planB', status: TaskStatus.PENDING, dueDate: iso(-5) }, // past wedding -> not counted overdue
    ]);
    repos.bookings.find.mockResolvedValue([
      { id: 'bk-planner', userId: 'clientA', providerType: ProviderType.PLANNER, providerId: 'pp1', status: BookingStatus.CONFIRMED, currency: 'INR' },
      { id: 'bk-vendorReq', userId: 'clientA', providerType: ProviderType.VENDOR, providerId: 'v9', status: BookingStatus.REQUESTED, currency: 'INR' },
      { id: 'bk-vendorDone', userId: 'clientB', providerType: ProviderType.VENDOR, providerId: 'v9', status: BookingStatus.COMPLETED, currency: 'INR' },
    ]);
    repos.plannerProfiles.find.mockResolvedValue([{ id: 'pp1' }]);
    // Only the planner's own booking's held payment is their escrow.
    repos.payments.find.mockResolvedValue([
      { bookingId: 'bk-planner', status: PaymentStatus.HELD_IN_ESCROW, payoutAmount: '500.00' },
    ]);

    const out = await service.plannerOverview('planner-1');

    expect(out.weddings).toBe(2);
    expect(out.active).toBe(1);
    expect(out.upcoming).toBe(0);
    expect(out.completed).toBe(1);
    expect(out.clients).toBe(2);
    // confirmed = the planner CONFIRMED booking + the vendor COMPLETED booking.
    expect(out.bookings).toEqual({ total: 3, confirmed: 2, pending: 1 });
    expect(out.escrowHeld).toBe('500.00');
    // Escrow is scoped to the planner's own bookings, not every booking.
    expect(repos.payments.find).toHaveBeenCalledWith({ where: { bookingId: expect.anything() } });
    expect(out.tasks).toEqual({ total: 3, done: 0, overdue: 1 });
  });
});
