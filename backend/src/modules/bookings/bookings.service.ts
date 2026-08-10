import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { Payment } from './entities/payment.entity';
import { CreateBookingDto } from './dto/booking.dto';
import { BookingStatus, PaymentStatus } from '../../common/enums';
import { AppConfigService } from '../../config/app-config.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment.provider';

/**
 * Booking lifecycle + escrow, implemented as an explicit state machine:
 *   REQUESTED to (pay) PENDING[escrow held] to (vendor confirms) CONFIRMED
 *             to (complete) COMPLETED[escrow released]
 *   any to CANCELLED[escrow refunded]
 */
const ALLOWED: Record<BookingStatus, BookingStatus[]> = {
  [BookingStatus.REQUESTED]: [BookingStatus.PENDING, BookingStatus.CANCELLED],
  [BookingStatus.PENDING]: [BookingStatus.CONFIRMED, BookingStatus.CANCELLED],
  [BookingStatus.CONFIRMED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.CANCELLED]: [],
};

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly cfg: AppConfigService,
    private readonly outbox: OutboxService,
    private readonly dataSource: DataSource,
    @Inject(PAYMENT_PROVIDER) private readonly gateway: PaymentProvider,
  ) {}

  async create(userId: string, dto: CreateBookingDto): Promise<Booking> {
    return this.bookings.save(
      this.bookings.create({
        userId,
        vendorId: dto.vendorId,
        amount: dto.amount.toFixed(2),
        currency: this.cfg.payments.currency,
        eventDate: dto.eventDate ?? null,
        notes: dto.notes,
        status: BookingStatus.REQUESTED,
      }),
    );
  }

  /** Initiate payment to funds held in escrow to booking moves to PENDING. */
  async pay(userId: string, bookingId: string): Promise<{ booking: Booking; payment: Payment }> {
    return this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);
      const paymentRepo = manager.getRepository(Payment);

      const booking = await bookingRepo.findOne({ where: { id: bookingId } });
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.userId !== userId) throw new BadRequestException('Not your booking');
      this.assertTransition(booking.status, BookingStatus.PENDING);

      const intent = await this.gateway.createEscrowHold(booking.amount, booking.currency);
      const payment = await paymentRepo.save(
        paymentRepo.create({
          bookingId: booking.id,
          userId,
          amount: booking.amount,
          currency: booking.currency,
          status: PaymentStatus.HELD_IN_ESCROW,
          provider: this.cfg.payments.provider,
          providerRef: intent.providerRef,
        }),
      );

      booking.status = BookingStatus.PENDING;
      await bookingRepo.save(booking);
      await this.outbox.record(
        {
          eventType: 'booking.payment_held',
          aggregateType: 'booking',
          payload: { bookingId: booking.id, userId, amount: booking.amount },
        },
        manager,
      );
      return { booking, payment };
    });
  }

  /** Vendor confirms the pending booking. */
  async confirm(bookingId: string): Promise<Booking> {
    const booking = await this.transition(bookingId, BookingStatus.CONFIRMED);
    await this.outbox.record({
      eventType: 'booking.confirmed',
      aggregateType: 'booking',
      payload: { bookingId },
    });
    return booking;
  }

  /** Complete the event to release escrow to the vendor. */
  async complete(bookingId: string): Promise<Booking> {
    const booking = await this.transition(bookingId, BookingStatus.COMPLETED);
    const payment = await this.payments.findOne({
      where: { bookingId, status: PaymentStatus.HELD_IN_ESCROW },
    });
    if (payment?.providerRef) {
      await this.gateway.release(payment.providerRef);
      await this.payments.update(payment.id, { status: PaymentStatus.RELEASED });
    }
    return booking;
  }

  /** Cancel to refund any escrow-held payment. */
  async cancel(bookingId: string): Promise<Booking> {
    const booking = await this.transition(bookingId, BookingStatus.CANCELLED);
    const payment = await this.payments.findOne({
      where: { bookingId, status: PaymentStatus.HELD_IN_ESCROW },
    });
    if (payment?.providerRef) {
      await this.gateway.refund(payment.providerRef);
      await this.payments.update(payment.id, { status: PaymentStatus.REFUNDED });
    }
    return booking;
  }

  listForUser(userId: string): Promise<Booking[]> {
    return this.bookings.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  private async transition(bookingId: string, to: BookingStatus): Promise<Booking> {
    const booking = await this.bookings.findOne({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');
    this.assertTransition(booking.status, to);
    booking.status = to;
    return this.bookings.save(booking);
  }

  private assertTransition(from: BookingStatus, to: BookingStatus): void {
    if (!ALLOWED[from].includes(to)) {
      throw new BadRequestException(`Illegal booking transition ${from} to ${to}`);
    }
  }
}
