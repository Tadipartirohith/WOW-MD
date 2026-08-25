import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { Quotation } from './entities/quotation.entity';
import { RespondQuotationDto, SendQuotationDto } from './dto/quotation.dto';
import { BookingsService } from './bookings.service';
import { AppConfigService } from '../../config/app-config.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { BookingStatus, QuotationStatus } from '../../common/enums';

/** Two weeks is long enough to decide and short enough that prices still hold. */
const DEFAULT_VALIDITY_DAYS = 14;

/**
 * The quotation half of the booking lifecycle.
 *
 * A wedding vendor cannot price a job from a listing — the quote depends on the
 * date, the guest count and what the family actually wants. So a booking starts
 * as a request with no committed price, the vendor quotes, and only an accepted
 * quotation sets the amount the buyer will be charged.
 */
@Injectable()
export class QuotationsService {
  constructor(
    @InjectRepository(Quotation) private readonly quotations: Repository<Quotation>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly bookingsService: BookingsService,
    private readonly cfg: AppConfigService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * The provider prices the request.
   *
   * Re-quoting is allowed and supersedes the previous offer rather than editing
   * it, so the buyer never sees a price change under them silently and the
   * history survives for any later dispute.
   */
  async send(actor: AuthUser, bookingId: string, dto: SendQuotationDto): Promise<Quotation> {
    const booking = await this.loadBooking(bookingId);
    await this.bookingsService.assertSeller(actor, booking);

    if (
      booking.status !== BookingStatus.REQUESTED &&
      booking.status !== BookingStatus.QUOTATION_SENT
    ) {
      throw new BadRequestException(
        `A quotation cannot be sent while the booking is ${booking.status}`,
      );
    }

    if (dto.lines?.length) {
      const sum = dto.lines.reduce((total, line) => total + Math.round(line.amount * 100), 0);
      if (sum !== Math.round(dto.amount * 100)) {
        throw new BadRequestException('The line items do not add up to the quoted amount');
      }
    }

    // Everything the request can be refused for is checked before anything is
    // written. The supersede used to come first, so a re-quote refused for a
    // validity date in the past took the *live* offer down with it: the vendor
    // mistyped a year, and the buyer's quotation quietly ceased to exist with
    // nothing to accept and no new offer to replace it.
    const validUntil = dto.validUntil
      ? new Date(dto.validUntil)
      : new Date(Date.now() + DEFAULT_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
    if (validUntil.getTime() <= Date.now()) {
      throw new BadRequestException('The validity date must be in the future');
    }

    await this.quotations.update(
      { bookingId, status: QuotationStatus.SENT },
      { status: QuotationStatus.SUPERSEDED },
    );

    const quotation = await this.quotations.save(
      this.quotations.create({
        bookingId,
        issuedByUserId: actor.userId,
        amount: dto.amount.toFixed(2),
        currency: booking.currency || this.cfg.payments.currency,
        lines: dto.lines ?? [],
        notes: dto.notes ?? null,
        terms: dto.terms ?? null,
        validUntil,
        status: QuotationStatus.SENT,
      }),
    );

    if (booking.status === BookingStatus.REQUESTED) {
      booking.status = BookingStatus.QUOTATION_SENT;
      await this.bookings.save(booking);
    }

    await this.outbox.record({
      eventType: 'booking.quotation_sent',
      aggregateType: 'booking',
      payload: { bookingId, quotationId: quotation.id, amount: quotation.amount },
    });
    return quotation;
  }

  /**
   * The buyer accepts. This is the moment the booking gets its price: the
   * quoted amount is copied onto the booking, because every milestone and
   * refund downstream is computed from it.
   */
  async accept(actor: AuthUser, quotationId: string, dto: RespondQuotationDto): Promise<Booking> {
    const quotation = await this.loadOrFail(quotationId);
    const booking = await this.loadBooking(quotation.bookingId);
    await this.bookingsService.assertBuyer(actor, booking);

    this.assertLive(quotation);
    if (booking.status !== BookingStatus.QUOTATION_SENT) {
      throw new BadRequestException('That booking is not waiting on a quotation decision');
    }

    quotation.status = QuotationStatus.ACCEPTED;
    quotation.respondedByUserId = actor.userId;
    quotation.respondedAt = new Date();
    quotation.responseNote = dto.note ?? null;
    await this.quotations.save(quotation);

    booking.amount = quotation.amount;
    booking.currency = quotation.currency;
    // Which offer this booking is. Every quotation on a booking is kept, so
    // without this the agreed terms are "the newest one", which is exactly
    // wrong: a vendor who re-quotes after acceptance would rewrite the deal.
    booking.acceptedQuotationId = quotation.id;
    // Acceptance settles the price and nothing else. The provider still has to
    // accept the job before any money moves — they may have taken another
    // booking in the days the quotation sat unanswered.
    booking.status = BookingStatus.QUOTATION_ACCEPTED;
    const saved = await this.bookings.save(booking);

    await this.outbox.record({
      eventType: 'booking.quotation_accepted',
      aggregateType: 'booking',
      payload: { bookingId: booking.id, quotationId, amount: quotation.amount },
    });
    return saved;
  }

  /** The buyer declines. The booking returns to the vendor to re-price. */
  async reject(actor: AuthUser, quotationId: string, dto: RespondQuotationDto): Promise<Quotation> {
    const quotation = await this.loadOrFail(quotationId);
    const booking = await this.loadBooking(quotation.bookingId);
    await this.bookingsService.assertBuyer(actor, booking);
    this.assertLive(quotation);

    quotation.status = QuotationStatus.REJECTED;
    quotation.respondedByUserId = actor.userId;
    quotation.respondedAt = new Date();
    quotation.responseNote = dto.note ?? null;
    const saved = await this.quotations.save(quotation);

    if (booking.status === BookingStatus.QUOTATION_SENT) {
      booking.status = BookingStatus.REQUESTED;
      await this.bookings.save(booking);
    }
    return saved;
  }

  /** Every quotation on a booking, newest first. Either side may read them. */
  async list(actor: AuthUser, bookingId: string): Promise<Quotation[]> {
    const booking = await this.loadBooking(bookingId);
    await this.bookingsService.assertEitherSide(actor, booking);

    const rows = await this.quotations.find({
      where: { bookingId },
      order: { createdAt: 'DESC' },
    });
    // Lapse anything past its date as it is read, so the buyer is never shown a
    // live-looking offer that acceptance would refuse.
    for (const row of rows) {
      if (this.hasLapsed(row)) {
        row.status = QuotationStatus.EXPIRED;
        await this.quotations.update(row.id, { status: QuotationStatus.EXPIRED });
      }
    }
    return rows;
  }

  /** The offer currently on the table, if there is one. */
  async current(bookingId: string): Promise<Quotation | null> {
    const row = await this.quotations.findOne({
      where: { bookingId, status: QuotationStatus.SENT },
      order: { createdAt: 'DESC' },
    });
    if (row && this.hasLapsed(row)) {
      await this.quotations.update(row.id, { status: QuotationStatus.EXPIRED });
      return null;
    }
    return row;
  }

  private hasLapsed(quotation: Quotation): boolean {
    return (
      quotation.status === QuotationStatus.SENT &&
      quotation.validUntil !== null &&
      quotation.validUntil.getTime() <= Date.now()
    );
  }

  private assertLive(quotation: Quotation): void {
    if (this.hasLapsed(quotation)) {
      throw new BadRequestException('That quotation has expired. Ask the provider to re-quote.');
    }
    if (quotation.status !== QuotationStatus.SENT) {
      throw new BadRequestException(`That quotation has already been ${quotation.status}`);
    }
  }

  private async loadOrFail(id: string): Promise<Quotation> {
    const quotation = await this.quotations.findOne({ where: { id } });
    if (!quotation) throw new NotFoundException('Quotation not found');
    return quotation;
  }

  private async loadBooking(bookingId: string): Promise<Booking> {
    const booking = await this.bookings.findOne({
      where: { id: bookingId, status: Not(BookingStatus.CANCELLED) },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }
}
