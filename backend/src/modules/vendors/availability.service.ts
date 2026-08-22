import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, Repository } from 'typeorm';
import { Vendor } from './entities/vendor.entity';
import { VendorAvailabilitySlot } from './entities/vendor-availability-slot.entity';
import { BlockSlotDto, CreateSlotDto, UpdateSlotDto } from './dto/availability.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { SlotStatus, UserRole } from '../../common/enums';
import { VendorServicesService } from '../catalog/vendor-services.service';

export interface AvailabilitySummary {
  from: string;
  to: string;
  totalSlots: number;
  /** Windows that could take another booking today. */
  openSlots: number;
  /** Windows with at least one request waiting on the vendor. */
  requestedSlots: number;
  /** Windows with at least one confirmed booking, full or not. */
  bookedSlots: number;
  /** Windows at capacity. A subset of `bookedSlots`. */
  fullSlots: number;
  blockedSlots: number;
  /** Confirmed bookings across the range, not windows. */
  confirmedBookings: number;
  pendingRequests: number;
}

/**
 * What a slot *is*, as opposed to what the vendor set it to.
 *
 * `status` on the row records the vendor's decision — published, blocked,
 * cancelled. Everything else is arithmetic over capacity and the two counters,
 * which is what stops "booked" and "full" from being the same flag and what
 * makes `remaining` impossible to get out of step.
 */
export type SlotState = 'open' | 'booked' | 'full' | 'blocked' | 'cancelled';

export interface SlotView {
  id: string;
  vendorId: string;
  vendorServiceId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  confirmed: number;
  pending: number;
  remaining: number;
  state: SlotState;
  /** Whether a buyer could request this window right now. */
  bookable: boolean;
  note: string | null;
  blockReason: string | null;
  /** What the vendor may do to it, so the client renders the rule rather than guessing. */
  actions: { canEdit: boolean; canRetime: boolean; canBlock: boolean; canDelete: boolean };
}

/** How far ahead a vendor may publish. Three months, rolling. */
const WINDOW_MONTHS = 3;

/**
 * A vendor's calendar, and the rules that stop the same window being sold
 * twice — or, just as damagingly, being taken off sale by somebody who has
 * merely asked about it.
 *
 * Three things here are load-bearing.
 *
 * The window is **rolling** — computed from today on every request rather than
 * stored — so a vendor never has to open a new quarter by hand.
 *
 * A slot is never deleted once anyone has asked for it: the row is what the
 * booking, the payments and any later dispute all point at, so it changes
 * state instead of disappearing.
 *
 * And **a request does not consume capacity**. `pending` and `confirmed` are
 * separate counters, and only the second is subtracted from capacity. The
 * earlier design flipped the whole window to PENDING the moment a request
 * arrived, which took a caterer's five-team afternoon off sale because one
 * family had enquired about it.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    @InjectRepository(VendorAvailabilitySlot)
    private readonly slots: Repository<VendorAvailabilitySlot>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
    @Inject(forwardRef(() => VendorServicesService))
    private readonly services: VendorServicesService,
  ) {}

  /** Today, and today plus three months, as ISO dates. */
  window(): { from: string; to: string } {
    const today = new Date();
    const from = today.toISOString().slice(0, 10);
    const end = new Date(today);
    end.setMonth(end.getMonth() + WINDOW_MONTHS);
    return { from, to: end.toISOString().slice(0, 10) };
  }

  // -------------------------------------------------------------- the view

  /**
   * The single place a slot is turned into what anybody reads.
   *
   * Every route returns this rather than the raw row, so the client never has
   * to re-derive `remaining` or decide what "booked" means — and cannot get a
   * different answer from the server.
   */
  view(slot: VendorAvailabilitySlot): SlotView {
    const remaining = Math.max(0, slot.capacity - slot.confirmed);

    const state: SlotState =
      slot.status === SlotStatus.CANCELLED
        ? 'cancelled'
        : slot.status === SlotStatus.BLOCKED
          ? 'blocked'
          : remaining === 0
            ? 'full'
            : slot.confirmed > 0
              ? 'booked'
              : 'open';

    const published = slot.status !== SlotStatus.CANCELLED && slot.status !== SlotStatus.BLOCKED;

    return {
      id: slot.id,
      vendorId: slot.vendorId,
      vendorServiceId: slot.vendorServiceId,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      capacity: slot.capacity,
      confirmed: slot.confirmed,
      pending: slot.pending,
      remaining,
      state,
      bookable: published && remaining > 0,
      note: slot.note,
      blockReason: slot.blockReason,
      actions: {
        // Capacity and the note stay editable for the life of the window; the
        // times do not, once somebody has planned their day around them.
        canEdit: slot.status !== SlotStatus.CANCELLED,
        canRetime: slot.confirmed === 0 && slot.pending === 0,
        canBlock: slot.status === SlotStatus.AVAILABLE && slot.confirmed === 0,
        canDelete: slot.confirmed === 0 && slot.pending === 0,
      },
    };
  }

  // ----------------------------------------------------------- vendor side

  async create(actor: AuthUser, vendorId: string, dto: CreateSlotDto): Promise<SlotView> {
    await this.assertOwner(actor, vendorId);
    this.assertWithinWindow(dto.date);
    this.assertTimeOrder(dto.startTime, dto.endTime);

    // Capacity comes from the service where the vendor named one, because that
    // is where "five catering teams" and "one convention hall" are actually
    // recorded. An explicit capacity on the request still wins.
    let capacity = dto.capacity ?? 1;
    if (dto.vendorServiceId) {
      const service = await this.services.findService(dto.vendorServiceId);
      if (!service || service.vendorId !== vendorId) {
        throw new BadRequestException('That service is not on this business');
      }
      capacity = dto.capacity ?? service.concurrentCapacity;
    }

    await this.assertNoIdenticalWindow(
      vendorId,
      dto.date,
      dto.startTime,
      dto.endTime,
      dto.vendorServiceId ?? null,
    );

    const saved = await this.slots.save(
      this.slots.create({
        vendorId,
        vendorServiceId: dto.vendorServiceId ?? null,
        date: dto.date,
        startTime: dto.startTime,
        endTime: dto.endTime,
        capacity,
        confirmed: 0,
        pending: 0,
        status: SlotStatus.AVAILABLE,
        note: dto.note ?? null,
      }),
    );
    return this.view(saved);
  }

  async update(
    actor: AuthUser,
    vendorId: string,
    slotId: string,
    dto: UpdateSlotDto,
  ): Promise<SlotView> {
    await this.assertOwner(actor, vendorId);
    const slot = await this.loadOrFail(vendorId, slotId);

    if (slot.status === SlotStatus.CANCELLED) {
      throw new BadRequestException('That slot has been cancelled and cannot be edited');
    }

    const retiming =
      (dto.startTime !== undefined && dto.startTime !== slot.startTime.slice(0, 5)) ||
      (dto.endTime !== undefined && dto.endTime !== slot.endTime.slice(0, 5));

    if (retiming && (slot.confirmed > 0 || slot.pending > 0)) {
      // Somebody has already planned their day around this window.
      throw new BadRequestException(
        slot.confirmed > 0
          ? 'This slot has confirmed bookings, so its times cannot be changed.'
          : 'Somebody has an open request against this slot. Answer it before re-timing.',
      );
    }

    const startTime = dto.startTime ?? slot.startTime;
    const endTime = dto.endTime ?? slot.endTime;
    if (retiming) {
      this.assertTimeOrder(startTime, endTime);
      await this.assertNoIdenticalWindow(
        vendorId,
        slot.date,
        startTime,
        endTime,
        slot.vendorServiceId,
        slotId,
      );
    }

    if (dto.capacity !== undefined && dto.capacity < slot.confirmed) {
      throw new BadRequestException(
        `That slot already holds ${slot.confirmed} confirmed booking(s); capacity cannot go below that`,
      );
    }

    slot.startTime = startTime;
    slot.endTime = endTime;
    if (dto.capacity !== undefined) slot.capacity = dto.capacity;
    if (dto.note !== undefined) slot.note = dto.note ?? null;
    return this.view(await this.slots.save(slot));
  }

  /**
   * Deleting is only ever allowed on a window nobody has touched.
   *
   * The two refusals say different things because they need different answers:
   * a confirmed booking means cancellation or support, an open request means
   * answering it first.
   */
  async remove(actor: AuthUser, vendorId: string, slotId: string): Promise<{ success: true }> {
    await this.assertOwner(actor, vendorId);
    const slot = await this.loadOrFail(vendorId, slotId);

    if (slot.confirmed > 0) {
      throw new BadRequestException(
        'This slot has confirmed bookings and cannot be deleted. Cancel them, or raise a support case.',
      );
    }
    if (slot.pending > 0) {
      throw new BadRequestException(
        `This slot has ${slot.pending} open request(s). Answer them before deleting it.`,
      );
    }

    await this.slots.remove(slot);
    return { success: true };
  }

  /**
   * Makes a window unavailable without losing it.
   *
   * Refused once anything is confirmed against it, because blocking would
   * otherwise silently invalidate a booking a family is relying on. Pending
   * requests do not block blocking — they are refusals waiting to happen, and
   * taking the window off sale is one way of making that decision.
   */
  async block(
    actor: AuthUser,
    vendorId: string,
    slotId: string,
    dto: BlockSlotDto,
  ): Promise<SlotView> {
    await this.assertOwner(actor, vendorId);
    const slot = await this.loadOrFail(vendorId, slotId);

    if (slot.confirmed > 0) {
      throw new BadRequestException(
        'This slot has confirmed bookings. Cancel them before blocking it, or the booking is invalidated without anybody being told.',
      );
    }
    if (slot.status === SlotStatus.BLOCKED) {
      throw new BadRequestException('That slot is already blocked');
    }

    slot.status = SlotStatus.BLOCKED;
    slot.blockReason = dto.reason ?? null;
    return this.view(await this.slots.save(slot));
  }

  async unblock(actor: AuthUser, vendorId: string, slotId: string): Promise<SlotView> {
    await this.assertOwner(actor, vendorId);
    const slot = await this.loadOrFail(vendorId, slotId);

    if (slot.status !== SlotStatus.BLOCKED) {
      throw new BadRequestException('That slot is not blocked');
    }
    slot.status = SlotStatus.AVAILABLE;
    slot.blockReason = null;
    return this.view(await this.slots.save(slot));
  }

  // ------------------------------------------------------------- reading

  private async rows(
    vendorId: string,
    from?: string,
    to?: string,
  ): Promise<VendorAvailabilitySlot[]> {
    const window = this.window();
    const start = from && from > window.from ? from : window.from;
    const end = to && to < window.to ? to : window.to;

    return this.slots.find({
      where: { vendorId, date: Between(start, end) },
      order: { date: 'ASC', startTime: 'ASC' },
    });
  }

  /** The vendor's own view: every window in the range, whatever its state. */
  async list(vendorId: string, from?: string, to?: string): Promise<SlotView[]> {
    return (await this.rows(vendorId, from, to)).map((s) => this.view(s));
  }

  /**
   * The buyer's view: windows that can still take a booking.
   *
   * Full and blocked windows are absent rather than greyed out — the buyer is
   * choosing a time, and a list of times they cannot have is noise. Windows
   * with confirmed bookings but capacity left **are** included, with their
   * counts, so the buyer sees "3 of 5 taken, 2 left" rather than nothing.
   */
  async listBookable(vendorId: string, from?: string, to?: string): Promise<SlotView[]> {
    return (await this.list(vendorId, from, to)).filter((s) => s.bookable);
  }

  async summary(vendorId: string, from?: string, to?: string): Promise<AvailabilitySummary> {
    const window = this.window();
    const start = from ?? window.from;
    const end = to ?? window.to;
    const views = await this.list(vendorId, start, end);

    return {
      from: start,
      to: end,
      totalSlots: views.length,
      openSlots: views.filter((s) => s.bookable).length,
      requestedSlots: views.filter((s) => s.pending > 0).length,
      bookedSlots: views.filter((s) => s.confirmed > 0).length,
      fullSlots: views.filter((s) => s.state === 'full').length,
      blockedSlots: views.filter((s) => s.state === 'blocked').length,
      confirmedBookings: views.reduce((n, s) => n + s.confirmed, 0),
      pendingRequests: views.reduce((n, s) => n + s.pending, 0),
    };
  }

  /**
   * The slots behind one summary card.
   *
   * Every counter the summary reports is clickable, and this is what it opens.
   * A card that reports a number nothing can be done with is the defect the
   * specification calls out as "cards that appear clickable but do nothing".
   */
  async filtered(
    vendorId: string,
    bucket: 'published' | 'open' | 'requested' | 'booked' | 'full' | 'blocked',
    from?: string,
    to?: string,
  ): Promise<SlotView[]> {
    const views = await this.list(vendorId, from, to);
    switch (bucket) {
      case 'open':
        return views.filter((s) => s.bookable);
      case 'requested':
        return views.filter((s) => s.pending > 0);
      case 'booked':
        return views.filter((s) => s.confirmed > 0);
      case 'full':
        return views.filter((s) => s.state === 'full');
      case 'blocked':
        return views.filter((s) => s.state === 'blocked');
      case 'published':
      default:
        return views;
    }
  }

  /** Per-date rollup, for painting the calendar. */
  async calendar(vendorId: string, from?: string, to?: string) {
    const views = await this.list(vendorId, from, to);
    const byDate = new Map<string, SlotView[]>();
    for (const slot of views) {
      const list = byDate.get(slot.date) ?? [];
      list.push(slot);
      byDate.set(slot.date, list);
    }

    return [...byDate.entries()].map(([date, daySlots]) => {
      const bookable = daySlots.filter((s) => s.bookable).length;
      const pending = daySlots.reduce((n, s) => n + s.pending, 0);
      const confirmed = daySlots.reduce((n, s) => n + s.confirmed, 0);
      const blocked = daySlots.filter((s) => s.state === 'blocked').length;

      // The label the calendar cell shows. "Fully booked" and "blocked" read
      // very differently to a buyer, so they never collapse into one state.
      const state =
        daySlots.length === 0
          ? 'no_availability'
          : blocked === daySlots.length
            ? 'blocked'
            : bookable === 0
              ? 'fully_booked'
              : confirmed > 0
                ? 'partially_booked'
                : 'available';

      return {
        date,
        state,
        total: daySlots.length,
        bookable,
        pending,
        confirmed,
        blocked,
        remaining: daySlots.reduce((n, s) => n + s.remaining, 0),
      };
    });
  }

  // ------------------------------------------------------- booking side

  /**
   * Records a request against a window, inside the caller's transaction.
   *
   * The row is locked for update so two buyers racing for the last place
   * serialise here. What this does **not** do is take the window off sale: a
   * request is a question, and the answer is the vendor's. Capacity moves in
   * `confirm` below.
   */
  async reserve(manager: EntityManager, slotId: string): Promise<void> {
    const repo = manager.getRepository(VendorAvailabilitySlot);
    const slot = await repo.findOne({ where: { id: slotId }, lock: { mode: 'pessimistic_write' } });
    if (!slot) throw new NotFoundException('That time slot no longer exists');

    if (slot.status !== SlotStatus.AVAILABLE) {
      throw new BadRequestException('That time slot is not open for requests');
    }
    if (slot.confirmed >= slot.capacity) {
      throw new BadRequestException('That time slot is fully booked');
    }

    slot.pending += 1;
    await repo.save(slot);
  }

  /**
   * The vendor accepted the job. This is the only place capacity is consumed.
   *
   * Capacity is re-checked under the lock rather than trusted from the request:
   * between a family asking and a vendor answering, four other people may have
   * been confirmed. For a wedding vendor a double booking is the one failure
   * with no recovery, so it is checked twice and refused late rather than
   * discovered on the day.
   */
  async confirm(manager: EntityManager, slotId: string): Promise<void> {
    const repo = manager.getRepository(VendorAvailabilitySlot);
    const slot = await repo.findOne({ where: { id: slotId }, lock: { mode: 'pessimistic_write' } });
    if (!slot) return;

    if (slot.confirmed >= slot.capacity) {
      throw new BadRequestException(
        `That window is already full — ${slot.confirmed} of ${slot.capacity} confirmed. It cannot take another booking.`,
      );
    }

    slot.confirmed += 1;
    if (slot.pending > 0) slot.pending -= 1;
    await repo.save(slot);
  }

  /**
   * The request ended without a booking, or a confirmed booking was cancelled.
   *
   * `wasConfirmed` decides which counter comes down. The window itself stays —
   * it goes back on sale rather than disappearing.
   */
  async release(slotId: string, wasConfirmed: boolean): Promise<void> {
    const slot = await this.slots.findOne({ where: { id: slotId } });
    if (!slot) return;

    if (wasConfirmed) {
      if (slot.confirmed > 0) slot.confirmed -= 1;
    } else if (slot.pending > 0) {
      slot.pending -= 1;
    }
    await this.slots.save(slot);
  }

  /**
   * Is this window still open, and does it belong to this vendor?
   *
   * Called when a request is submitted, so a buyer working from a stale page
   * is refused by the server rather than by the vendor a week later.
   */
  async isBookable(vendorId: string, slotId: string): Promise<boolean> {
    const slot = await this.slots.findOne({ where: { id: slotId, vendorId } });
    if (!slot) return false;
    return slot.status === SlotStatus.AVAILABLE && slot.confirmed < slot.capacity;
  }

  async findSlot(slotId: string): Promise<VendorAvailabilitySlot | null> {
    return this.slots.findOne({ where: { id: slotId } });
  }

  // ---------------------------------------------------------------- rules

  private assertWithinWindow(date: string): void {
    const { from, to } = this.window();
    if (date < from) throw new BadRequestException('That date has already passed');
    if (date > to) {
      throw new BadRequestException(`Availability can only be published up to ${to}`);
    }
  }

  private assertTimeOrder(startTime: string, endTime: string): void {
    if (startTime >= endTime) {
      throw new BadRequestException('The end time has to be after the start time');
    }
  }

  /**
   * Overlapping windows are allowed; identical ones are not.
   *
   * The old rule refused any overlap outright, which is wrong for exactly the
   * reason the specification gives: capacity is what governs how much a vendor
   * can do at once, not the clock. A caterer running a lunch and an evening
   * that share an hour of setup is normal. What is never useful is publishing
   * the same window twice for the same service, which is a mis-click that
   * splits one capacity across two rows.
   */
  private async assertNoIdenticalWindow(
    vendorId: string,
    date: string,
    startTime: string,
    endTime: string,
    vendorServiceId: string | null,
    excludeSlotId?: string,
  ): Promise<void> {
    const sameDay = await this.slots.find({ where: { vendorId, date } });
    const clash = sameDay.find(
      (slot) =>
        slot.id !== excludeSlotId &&
        slot.status !== SlotStatus.CANCELLED &&
        (slot.vendorServiceId ?? null) === vendorServiceId &&
        slot.startTime.slice(0, 5) === startTime.slice(0, 5) &&
        slot.endTime.slice(0, 5) === endTime.slice(0, 5),
    );
    if (clash) {
      throw new BadRequestException(
        `You have already published ${startTime.slice(0, 5)}–${endTime.slice(0, 5)} on ${date}. ` +
          `Raise its capacity instead of publishing it twice.`,
      );
    }
  }

  private async loadOrFail(vendorId: string, slotId: string): Promise<VendorAvailabilitySlot> {
    const slot = await this.slots.findOne({ where: { id: slotId, vendorId } });
    if (!slot) throw new NotFoundException('Slot not found');
    return slot;
  }

  private async assertOwner(actor: AuthUser, vendorId: string): Promise<void> {
    const vendor = await this.vendors.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Business not found');
    if (actor.role !== UserRole.ADMIN && vendor.ownerUserId !== actor.userId) {
      throw new ForbiddenException('That business is not yours');
    }
  }
}
