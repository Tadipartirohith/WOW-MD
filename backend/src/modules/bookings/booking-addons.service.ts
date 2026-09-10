import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Booking } from './entities/booking.entity';
import { BookingAddon } from './entities/booking-addon.entity';
import {
  CreateBookingAddonDto,
  RequoteBookingAddonDto,
  RespondBookingAddonDto,
} from './dto/booking-addon.dto';
import { BookingsService } from './bookings.service';
import { AppConfigService } from '../../config/app-config.service';
import { OutboxService } from '../../platform/events/outbox.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { BookingAddonStatus, BookingStatus } from '../../common/enums';

/**
 * Add-ons: extra services a buyer asks for on a booking whose advance is already
 * held (EZ1-I215).
 *
 * It mirrors the quotation flow one confirmed booking deeper. The buyer proposes
 * an extra (optionally at a predefined price); the vendor accepts it, rejects
 * it, or requotes with their own price; a requote then waits on the buyer to
 * accept the vendor's price. Every request is its own row and is never edited
 * away, so the agreed add-on and what it was agreed at survive for a later
 * dispute exactly as a quotation does.
 *
 * Paying an accepted add-on into escrow is out of scope here — the row records
 * the agreement and its price; wiring the instalment is a follow-up.
 */
@Injectable()
export class BookingAddonsService {
  /** An add-on can only be raised once the booking is live: advance held, or work underway. */
  private static readonly REQUESTABLE: readonly BookingStatus[] = [
    BookingStatus.CONFIRMED,
    BookingStatus.IN_PROGRESS,
  ];

  constructor(
    @InjectRepository(BookingAddon) private readonly addons: Repository<BookingAddon>,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly bookingsService: BookingsService,
    private readonly cfg: AppConfigService,
    private readonly outbox: OutboxService,
  ) {}

  /** The buyer asks for an extra service on their confirmed booking. */
  async create(
    actor: AuthUser,
    bookingId: string,
    dto: CreateBookingAddonDto,
  ): Promise<BookingAddon> {
    const booking = await this.loadBooking(bookingId);
    await this.bookingsService.assertBuyer(actor, booking);

    if (!BookingAddonsService.REQUESTABLE.includes(booking.status)) {
      throw new BadRequestException(
        'Add-ons can only be requested once the booking is confirmed and the advance is held',
      );
    }

    const addon = await this.addons.save(
      this.addons.create({
        bookingId,
        requestedByUserId: actor.userId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        quantity: dto.quantity ?? 1,
        proposedPrice: dto.proposedPrice != null ? dto.proposedPrice.toFixed(2) : null,
        vendorPrice: null,
        currency: booking.currency || this.cfg.payments.currency,
        note: dto.note?.trim() || null,
        status: BookingAddonStatus.REQUESTED,
      }),
    );

    await this.outbox.record({
      eventType: 'booking.addon_requested',
      aggregateType: 'booking',
      payload: { bookingId, addonId: addon.id, title: addon.title },
    });
    return addon;
  }

  /** Every add-on on a booking, newest first. Either side may read them. */
  async list(actor: AuthUser, bookingId: string): Promise<BookingAddon[]> {
    const booking = await this.loadBooking(bookingId);
    await this.bookingsService.assertEitherSide(actor, booking);
    return this.addons.find({ where: { bookingId }, order: { createdAt: 'DESC' } });
  }

  /**
   * The vendor accepts the add-on as asked. The proposed price, if any, becomes
   * the agreed price so the record does not depend on a nullable field later.
   */
  async vendorAccept(
    actor: AuthUser,
    addonId: string,
    dto: RespondBookingAddonDto,
  ): Promise<BookingAddon> {
    const { addon } = await this.loadForSeller(actor, addonId);
    this.assertAwaitingVendor(addon);

    addon.status = BookingAddonStatus.ACCEPTED;
    addon.vendorPrice = addon.proposedPrice;
    return this.recordResponse(addon, actor, dto.note, 'booking.addon_accepted');
  }

  /** The vendor turns the add-on down. */
  async vendorReject(
    actor: AuthUser,
    addonId: string,
    dto: RespondBookingAddonDto,
  ): Promise<BookingAddon> {
    const { addon } = await this.loadForSeller(actor, addonId);
    this.assertAwaitingVendor(addon);

    addon.status = BookingAddonStatus.REJECTED;
    return this.recordResponse(addon, actor, dto.note, 'booking.addon_rejected');
  }

  /** The vendor counters with their own price; the ball goes back to the buyer. */
  async vendorRequote(
    actor: AuthUser,
    addonId: string,
    dto: RequoteBookingAddonDto,
  ): Promise<BookingAddon> {
    const { addon } = await this.loadForSeller(actor, addonId);
    this.assertAwaitingVendor(addon);

    addon.status = BookingAddonStatus.REQUOTED;
    addon.vendorPrice = dto.vendorPrice.toFixed(2);
    return this.recordResponse(addon, actor, dto.note, 'booking.addon_requoted');
  }

  /** The buyer accepts the vendor's requoted price. That settles the add-on. */
  async buyerAcceptRequote(
    actor: AuthUser,
    addonId: string,
    dto: RespondBookingAddonDto,
  ): Promise<BookingAddon> {
    const addon = await this.loadForBuyer(actor, addonId);
    if (addon.status !== BookingAddonStatus.REQUOTED) {
      throw new BadRequestException('This add-on is not waiting on a requote decision');
    }

    addon.status = BookingAddonStatus.ACCEPTED;
    return this.recordResponse(addon, actor, dto.note, 'booking.addon_accepted');
  }

  /** The buyer withdraws the request, or declines a requote. */
  async buyerReject(
    actor: AuthUser,
    addonId: string,
    dto: RespondBookingAddonDto,
  ): Promise<BookingAddon> {
    const addon = await this.loadForBuyer(actor, addonId);
    if (
      addon.status !== BookingAddonStatus.REQUESTED &&
      addon.status !== BookingAddonStatus.REQUOTED
    ) {
      throw new BadRequestException(`This add-on has already been ${addon.status}`);
    }

    addon.status = BookingAddonStatus.REJECTED;
    return this.recordResponse(addon, actor, dto.note, 'booking.addon_rejected');
  }

  private assertAwaitingVendor(addon: BookingAddon): void {
    if (addon.status !== BookingAddonStatus.REQUESTED) {
      throw new BadRequestException(`This add-on has already been ${addon.status}`);
    }
  }

  private async recordResponse(
    addon: BookingAddon,
    actor: AuthUser,
    note: string | undefined,
    eventType: string,
  ): Promise<BookingAddon> {
    addon.respondedByUserId = actor.userId;
    addon.respondedAt = new Date();
    addon.responseNote = note?.trim() || null;
    const saved = await this.addons.save(addon);

    /*
     * An accepted add-on is money owed, so it goes onto the booking.
     *
     * Accepting recorded the add-on and stopped there: the row read `accepted`
     * at the agreed price while the booking still showed the original amount,
     * so the couple owed 6,500 that appeared on no total, no instalment and no
     * payments page (EZ1-I215). The booking total is the one number every
     * downstream reader trusts -- escrow, commission, the vendor's accounts --
     * and it has to carry what was actually agreed.
     *
     * Summed from the accepted add-ons rather than incremented, so a
     * double-submitted acceptance cannot add the same extra twice.
     */
    if (addon.status === BookingAddonStatus.ACCEPTED) {
      await this.applyAcceptedAddons(addon.bookingId);
    }

    await this.outbox.record({
      eventType,
      aggregateType: 'booking',
      payload: { bookingId: addon.bookingId, addonId: addon.id, status: addon.status },
    });
    return saved;
  }

  /**
   * Re-totals a booking from its base amount plus everything accepted on it.
   *
   * `baseAmount` is written the first time an add-on is accepted and never
   * again, so the original figure survives however many extras are agreed
   * afterwards and the sum stays idempotent.
   */
  private async applyAcceptedAddons(bookingId: string): Promise<void> {
    const booking = await this.loadBooking(bookingId);
    const accepted = await this.addons.find({
      where: { bookingId, status: BookingAddonStatus.ACCEPTED },
    });

    if (booking.baseAmount === null || booking.baseAmount === undefined) {
      booking.baseAmount = booking.amount;
    }

    const extras = accepted.reduce((total, a) => {
      const agreed = a.vendorPrice ?? a.proposedPrice ?? '0';
      return total + Number(agreed) * (a.quantity ?? 1);
    }, 0);

    booking.amount = (Number(booking.baseAmount) + extras).toFixed(2);
    await this.bookings.save(booking);
  }

  private async loadForSeller(
    actor: AuthUser,
    addonId: string,
  ): Promise<{ addon: BookingAddon; booking: Booking }> {
    const addon = await this.loadOrFail(addonId);
    const booking = await this.loadBooking(addon.bookingId);
    await this.bookingsService.assertSeller(actor, booking);
    return { addon, booking };
  }

  private async loadForBuyer(actor: AuthUser, addonId: string): Promise<BookingAddon> {
    const addon = await this.loadOrFail(addonId);
    const booking = await this.loadBooking(addon.bookingId);
    await this.bookingsService.assertBuyer(actor, booking);
    return addon;
  }

  private async loadOrFail(id: string): Promise<BookingAddon> {
    const addon = await this.addons.findOne({ where: { id } });
    if (!addon) throw new NotFoundException('Add-on not found');
    return addon;
  }

  private async loadBooking(bookingId: string): Promise<Booking> {
    const booking = await this.bookings.findOne({
      where: { id: bookingId, status: Not(BookingStatus.CANCELLED) },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }
}
