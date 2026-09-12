import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Vendor } from '../vendors/entities/vendor.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { Payment } from '../bookings/entities/payment.entity';
import { WeddingEvent } from '../events/entities/event.entity';
import { Profile } from '../users/entities/profile.entity';
import { PlannerProfile } from '../wedding-planners/entities/planner-profile.entity';
import { VendorService } from '../catalog/entities/vendor-service.entity';
import { SupportCase } from '../verification/entities/support-case.entity';
import { AdminBookingQueryDto, AdminTransactionQueryDto } from './dto/console.dto';
import { PaymentStatus, ProviderType } from '../../common/enums';
import { PaginatedResult, paginate } from '../../common/dto/pagination.dto';

/** The names hung on a booking row so a list answers who/whom/what (EZ1-I173). */
export interface AdminBookingParties {
  buyerName: string | null;
  providerName: string | null;
  serviceName: string | null;
  amountPaid: string;
}

/**
 * Bookings and payments as the admin console reads them: the lists, one
 * booking or payment in full, and the names hung on each row.
 *
 * Split out of AdminConsoleService, which had grown past 1,600 lines; the
 * methods moved unchanged.
 */
@Injectable()
export class AdminBookingsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(WeddingEvent) private readonly events: Repository<WeddingEvent>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(PlannerProfile) private readonly planners: Repository<PlannerProfile>,
    @InjectRepository(VendorService) private readonly vendorServices: Repository<VendorService>,
    @InjectRepository(SupportCase) private readonly cases: Repository<SupportCase>,
  ) {}

  /**
   * One booking, with everybody and everything attached to it.
   *
   * A dispute is argued over exactly this: who booked, from whom, for which
   * day, at what price, what was quoted, what was paid and where that money is
   * now. It was six lookups by uuid, which is slow and is how the wrong
   * booking gets refunded.
   */
  async bookingDetail(bookingId: string) {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');

    const [client, payments, cases, vendor, planner, service] = await Promise.all([
      this.users.findOne({
        where: { id: booking.userId },
        select: ['id', 'email', 'phone', 'role', 'managedByAgentId'],
      }),
      this.payments.find({ where: { bookingId }, order: { createdAt: 'ASC' } }),
      this.cases.find({ where: { subjectId: bookingId }, order: { createdAt: 'DESC' } }),
      booking.providerType === ProviderType.VENDOR
        ? this.vendors.findOne({ where: { id: booking.providerId } })
        : Promise.resolve(null),
      booking.providerType === ProviderType.PLANNER
        ? this.planners.findOne({ where: { id: booking.providerId } })
        : Promise.resolve(null),
      booking.vendorServiceId
        ? this.vendorServices.findOne({ where: { id: booking.vendorServiceId } })
        : Promise.resolve(null),
    ]);

    const agent = client?.managedByAgentId
      ? await this.users.findOne({
          where: { id: client.managedByAgentId },
          select: ['id', 'email'],
        })
      : null;

    return {
      booking,
      client,
      // The agency behind the client, when there is one: an administrator
      // asking why a booking was made often has to ask who made it.
      agent,
      provider: vendor
        ? {
            id: vendor.id,
            ownerUserId: vendor.ownerUserId,
            name: vendor.name,
            category: vendor.category,
            status: vendor.status,
            type: booking.providerType,
          }
        : planner
          ? {
              id: planner.id,
              ownerUserId: planner.ownerUserId,
              name: planner.agencyName,
              category: 'Wedding planner',
              status: null,
              type: booking.providerType,
            }
          : { id: booking.providerId, type: booking.providerType },
      service: service ? { id: service.id, name: service.displayName } : null,
      payments,
      disputes: cases,
    };
  }

  /**
   * Every booking on the platform, across all thirteen stages.
   *
   * The vendor sees their incoming work and the buyer sees their own; nobody
   * could see the whole book. That is the view a dispute starts from — "what
   * else has this vendor got in flight" — and it is also the only way to notice
   * that forty bookings have been sitting in `payment_pending` for a fortnight.
   */
  async allBookings(
    q: AdminBookingQueryDto,
  ): Promise<PaginatedResult<Booking & AdminBookingParties>> {
    const qb = this.bookings.createQueryBuilder('b');
    if (q.status) qb.andWhere('b.status = :status', { status: q.status });
    if (q.providerId) qb.andWhere('b.providerId = :providerId', { providerId: q.providerId });
    if (q.userId) qb.andWhere('b.userId = :userId', { userId: q.userId });
    if (q.from) qb.andWhere('b.createdAt >= :from', { from: new Date(q.from) });
    if (q.to) {
      // Inclusive of the whole closing day, as every report window is. A bare
      // date parsed to midnight at the start of that day, so a count followed
      // here from Reports landed on fewer bookings than it said (EZ1-I242).
      const to = new Date(q.to);
      if (/^\d{4}-\d{2}-\d{2}$/.test(q.to)) to.setHours(23, 59, 59, 999);
      qb.andWhere('b.createdAt <= :to', { to });
    }

    qb.orderBy('b.createdAt', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);

    const [data, total] = await qb.getManyAndCount();
    const enriched = await this.attachParties(data);
    return paginate(enriched, total, q.page, q.limit);
  }

  /**
   * Put a name on every side of a booking (EZ1-I173).
   *
   * The list row has to answer "who booked whom, for what" without the admin
   * opening it: the buyer's display name, the provider's business name whether
   * it is a vendor or a planner, the service, and how much of the money has
   * actually been captured. Resolved in one batched read per kind rather than
   * per row, the same shape `transactions` already uses.
   */
  async attachParties(rows: Booking[]): Promise<(Booking & AdminBookingParties)[]> {
    if (rows.length === 0) return [];

    const buyerIds = [...new Set(rows.map((b) => b.userId))];
    const vendorIds = [
      ...new Set(
        rows.filter((b) => b.providerType === ProviderType.VENDOR).map((b) => b.providerId),
      ),
    ];
    const plannerIds = [
      ...new Set(
        rows.filter((b) => b.providerType === ProviderType.PLANNER).map((b) => b.providerId),
      ),
    ];
    const serviceIds = [...new Set(rows.map((b) => b.vendorServiceId).filter(Boolean))] as string[];
    const bookingIds = rows.map((b) => b.id);

    const [profiles, vendors, planners, services, payments] = await Promise.all([
      buyerIds.length
        ? this.profiles.find({ where: { userId: In(buyerIds) } })
        : Promise.resolve([]),
      vendorIds.length ? this.vendors.find({ where: { id: In(vendorIds) } }) : Promise.resolve([]),
      plannerIds.length
        ? this.planners.find({ where: { id: In(plannerIds) } })
        : Promise.resolve([]),
      serviceIds.length
        ? this.vendorServices.find({ where: { id: In(serviceIds) } })
        : Promise.resolve([]),
      this.payments.find({ where: { bookingId: In(bookingIds) } }),
    ]);

    const buyerName = new Map(profiles.map((p) => [p.userId as string, p.displayName]));
    const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
    const plannerName = new Map(planners.map((p) => [p.id, p.agencyName]));
    const serviceName = new Map(services.map((s) => [s.id, s.displayName]));

    // Money captured so far, per booking. INITIATED has not been taken and
    // REFUNDED has gone back, so neither counts as paid.
    const paidByBooking = new Map<string, number>();
    for (const p of payments) {
      if (p.status === PaymentStatus.INITIATED || p.status === PaymentStatus.REFUNDED) continue;
      paidByBooking.set(p.bookingId, (paidByBooking.get(p.bookingId) ?? 0) + Number(p.amount ?? 0));
    }

    return rows.map((b) => ({
      ...b,
      buyerName: buyerName.get(b.userId) ?? null,
      providerName:
        b.providerType === ProviderType.VENDOR
          ? (vendorName.get(b.providerId) ?? null)
          : (plannerName.get(b.providerId) ?? null),
      serviceName: b.vendorServiceId ? (serviceName.get(b.vendorServiceId) ?? null) : null,
      amountPaid: (paidByBooking.get(b.id) ?? 0).toFixed(2),
    }));
  }

  /**
   * Every payment on the platform, for the admin Payments/Transactions page
   * (EZ1-I111): the booking it is on, the customer and provider, the instalment,
   * amount, escrow/payout status and date. One row per payment, newest first.
   */
  async transactions(q: AdminTransactionQueryDto): Promise<
    PaginatedResult<{
      paymentId: string;
      bookingId: string;
      milestone: string;
      status: string;
      amount: string;
      commissionAmount: string;
      payoutAmount: string;
      currency: string;
      createdAt: Date;
      buyerName: string | null;
      providerName: string | null;
      providerType: string | null;
    }>
  > {
    const qb = this.payments.createQueryBuilder('p');
    if (q.status) qb.andWhere('p.status = :status', { status: q.status });
    qb.orderBy('p.createdAt', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit);
    const [rows, total] = await qb.getManyAndCount();
    if (rows.length === 0) return paginate([], total, q.page, q.limit);

    const bookings = await this.bookings.find({
      where: { id: In([...new Set(rows.map((r) => r.bookingId))]) },
    });
    const bookingById = new Map(bookings.map((b) => [b.id, b]));
    const buyerIds = [...new Set(bookings.map((b) => b.userId))];
    const vendorIds = [
      ...new Set(bookings.filter((b) => b.providerType === 'vendor').map((b) => b.providerId)),
    ];
    const [profiles, vendors] = await Promise.all([
      buyerIds.length
        ? this.profiles.find({ where: { userId: In(buyerIds) } })
        : Promise.resolve([]),
      vendorIds.length ? this.vendors.find({ where: { id: In(vendorIds) } }) : Promise.resolve([]),
    ]);
    const buyerName = new Map(profiles.map((p) => [p.userId as string, p.displayName]));
    const vendorName = new Map(vendors.map((v) => [v.id, v.name]));

    const data = rows.map((p) => {
      const b = bookingById.get(p.bookingId);
      return {
        paymentId: p.id,
        bookingId: p.bookingId,
        milestone: p.milestone,
        status: p.status,
        amount: p.amount,
        commissionAmount: p.commissionAmount,
        payoutAmount: p.payoutAmount,
        currency: p.currency,
        createdAt: p.createdAt,
        buyerName: b ? (buyerName.get(b.userId) ?? null) : null,
        providerName: b?.providerType === 'vendor' ? (vendorName.get(b.providerId) ?? null) : null,
        providerType: b?.providerType ?? null,
      };
    });
    return paginate(data, total, q.page, q.limit);
  }

  /**
   * One payment in full, for the admin Payment Details view (EZ1-I202).
   *
   * A single transaction row only makes sense against the whole booking it sits
   * on: the customer and provider it is between, the service and event it paid
   * for, and its sibling instalments — because "the advance released but the
   * balance is still in escrow" is the sentence an administrator is actually
   * reading. Gathered in one read the way `bookingDetail` already is, and the
   * escrow position is summed across every payment on the booking so the
   * numbers agree with the dashboard's cards.
   */
  async transactionDetail(paymentId: string) {
    const payment = await this.payments.findOne({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');

    const booking = await this.bookings.findOne({ where: { id: payment.bookingId } });

    const [siblings, client, vendor, planner, service, event] = await Promise.all([
      this.payments.find({ where: { bookingId: payment.bookingId }, order: { createdAt: 'ASC' } }),
      booking
        ? this.users.findOne({
            where: { id: booking.userId },
            select: ['id', 'email', 'phone', 'role'],
          })
        : Promise.resolve(null),
      booking?.providerType === ProviderType.VENDOR
        ? this.vendors.findOne({ where: { id: booking.providerId } })
        : Promise.resolve(null),
      booking?.providerType === ProviderType.PLANNER
        ? this.planners.findOne({ where: { id: booking.providerId } })
        : Promise.resolve(null),
      booking?.vendorServiceId
        ? this.vendorServices.findOne({ where: { id: booking.vendorServiceId } })
        : Promise.resolve(null),
      booking?.eventId
        ? this.events.findOne({ where: { id: booking.eventId } })
        : Promise.resolve(null),
    ]);

    const clientProfile = booking
      ? await this.profiles.findOne({ where: { userId: booking.userId } })
      : null;

    // The escrow position across the whole booking, summed the same way the
    // dashboard's cards are: held/released count `amount`, the provider's share
    // and commission come off the released rows, refunded counts `amount`.
    const sum = (predicate: (p: Payment) => boolean, column: keyof Payment) =>
      siblings
        .filter(predicate)
        .reduce((t, p) => t + Number((p[column] as string) ?? 0), 0)
        .toFixed(2);

    return {
      payment,
      booking: booking
        ? {
            id: booking.id,
            status: booking.status,
            amount: booking.amount,
            currency: booking.currency,
            eventDate: booking.eventDate,
            createdAt: booking.createdAt,
          }
        : null,
      customer: client
        ? {
            id: client.id,
            name: clientProfile?.displayName ?? null,
            email: client.email,
            phone: client.phone,
            role: client.role,
          }
        : null,
      provider: vendor
        ? {
            id: vendor.id,
            ownerUserId: vendor.ownerUserId,
            name: vendor.name,
            category: vendor.category,
            type: ProviderType.VENDOR,
          }
        : planner
          ? {
              id: planner.id,
              ownerUserId: planner.ownerUserId,
              name: planner.agencyName,
              category: 'Wedding planner',
              type: ProviderType.PLANNER,
            }
          : booking
            ? { id: booking.providerId, type: booking.providerType }
            : null,
      service: service ? { id: service.id, name: service.displayName } : null,
      event: event
        ? {
            id: event.id,
            name: event.name,
            venue: event.venue ?? null,
            city: event.city,
            eventDate: event.eventDate,
            startTime: event.startTime,
          }
        : null,
      // Every instalment on the booking, oldest first: the milestone breakdown
      // (advance/second/final) and the payment history/timeline are both read
      // off this list on the client.
      payments: siblings,
      summary: {
        total: booking?.amount ?? payment.amount,
        held: sum((p) => p.status === PaymentStatus.HELD_IN_ESCROW, 'amount'),
        released: sum((p) => p.status === PaymentStatus.RELEASED, 'amount'),
        refunded: sum((p) => p.status === PaymentStatus.REFUNDED, 'amount'),
        commission: sum((p) => p.status === PaymentStatus.RELEASED, 'commissionAmount'),
        payout: sum((p) => p.status === PaymentStatus.RELEASED, 'payoutAmount'),
      },
    };
  }
}
