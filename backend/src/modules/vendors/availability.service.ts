import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, In, Repository } from 'typeorm';
import { Vendor } from './entities/vendor.entity';
import { VendorAvailabilitySlot } from './entities/vendor-availability-slot.entity';
import { BlockSlotDto, CreateSlotDto, UpdateSlotDto } from './dto/availability.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { SlotStatus, UserRole } from '../../common/enums';

export interface AvailabilitySummary {
  from: string;
  to: string;
  totalSlots: number;
  availableSlots: number;
  pendingSlots: number;
  bookedSlots: number;
  blockedSlots: number;
}

/** How far ahead a vendor may publish. Three months, rolling. */
const WINDOW_MONTHS = 3;

/**
 * A vendor's calendar, and the rules that stop the same window being sold
 * twice.
 *
 * Two things here are load-bearing. The window is **rolling** — computed from
 * today on every request rather than stored — so a vendor never has to open a
 * new quarter by hand. And a slot is never deleted once anyone has asked for
 * it: the row is what the booking, the payments and any later dispute all point
 * at, so it changes status instead of disappearing.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    @InjectRepository(VendorAvailabilitySlot)
    private readonly slots: Repository<VendorAvailabilitySlot>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
  ) {}

  /** Today, and today plus three months, as ISO dates. */
  window(): { from: string; to: string } {
    const today = new Date();
    const from = today.toISOString().slice(0, 10);
    const end = new Date(today);
    end.setMonth(end.getMonth() + WINDOW_MONTHS);
    return { from, to: end.toISOString().slice(0, 10) };
  }

  // ----------------------------------------------------------- vendor side

  async create(
    actor: AuthUser,
    vendorId: string,
    dto: CreateSlotDto,
  ): Promise<VendorAvailabilitySlot> {
    await this.assertOwner(actor, vendorId);
    this.assertWithinWindow(dto.date);
    this.assertTimeOrder(dto.startTime, dto.endTime);
    await this.assertNoOverlap(vendorId, dto.date, dto.startTime, dto.endTime);

    return this.slots.save(
      this.slots.create({
        vendorId,
        date: dto.date,
        startTime: dto.startTime,
        endTime: dto.endTime,
        capacity: dto.capacity ?? 1,
        booked: 0,
        status: SlotStatus.AVAILABLE,
        note: dto.note ?? null,
      }),
    );
  }

  async update(
    actor: AuthUser,
    vendorId: string,
    slotId: string,
    dto: UpdateSlotDto,
  ): Promise<VendorAvailabilitySlot> {
    await this.assertOwner(actor, vendorId);
    const slot = await this.loadOrFail(vendorId, slotId);

    const retiming = dto.startTime !== undefined || dto.endTime !== undefined;
    if (retiming && slot.status !== SlotStatus.AVAILABLE) {
      // Somebody has already planned their day around this window.
      throw new BadRequestException(
        `The times cannot be changed once a slot is ${slot.status}`,
      );
    }

    const startTime = dto.startTime ?? slot.startTime;
    const endTime = dto.endTime ?? slot.endTime;
    if (retiming) {
      this.assertTimeOrder(startTime, endTime);
      await this.assertNoOverlap(vendorId, slot.date, startTime, endTime, slotId);
    }
    if (dto.capacity !== undefined && dto.capacity < slot.booked) {
      throw new BadRequestException(
        `That slot already holds ${slot.booked} booking(s); capacity cannot go below that`,
      );
    }

    slot.startTime = startTime;
    slot.endTime = endTime;
    if (dto.capacity !== undefined) slot.capacity = dto.capacity;
    if (dto.note !== undefined) slot.note = dto.note ?? null;
    return this.slots.save(slot);
  }

  /**
   * Deleting is only ever allowed on a window nobody has touched. Anything a
   * buyer has requested or taken is history, and history is not the vendor's to
   * erase.
   */
  async remove(actor: AuthUser, vendorId: string, slotId: string): Promise<{ success: true }> {
    await this.assertOwner(actor, vendorId);
    const slot = await this.loadOrFail(vendorId, slotId);

    if (slot.status !== SlotStatus.AVAILABLE && slot.status !== SlotStatus.BLOCKED) {
      throw new BadRequestException(
        `A ${slot.status} slot cannot be deleted — it is attached to a booking. Block it instead.`,
      );
    }
    await this.slots.remove(slot);
    return { success: true };
  }

  /** Makes a window unavailable without losing it. Reversible until booked. */
  async block(
    actor: AuthUser,
    vendorId: string,
    slotId: string,
    dto: BlockSlotDto,
  ): Promise<VendorAvailabilitySlot> {
    await this.assertOwner(actor, vendorId);
    const slot = await this.loadOrFail(vendorId, slotId);

    if (slot.status === SlotStatus.BOOKED || slot.status === SlotStatus.PENDING) {
      throw new BadRequestException(
        'That slot is already spoken for. Cancel the booking before blocking it.',
      );
    }
    slot.status = SlotStatus.BLOCKED;
    slot.blockReason = dto.reason ?? null;
    return this.slots.save(slot);
  }

  async unblock(actor: AuthUser, vendorId: string, slotId: string): Promise<VendorAvailabilitySlot> {
    await this.assertOwner(actor, vendorId);
    const slot = await this.loadOrFail(vendorId, slotId);

    if (slot.status !== SlotStatus.BLOCKED) {
      throw new BadRequestException('That slot is not blocked');
    }
    slot.status = SlotStatus.AVAILABLE;
    slot.blockReason = null;
    return this.slots.save(slot);
  }

  // ------------------------------------------------------------- reading

  /**
   * The vendor's own view: every slot in the range, whatever its status.
   * Defaults to the rolling window, and never reaches outside it.
   */
  async list(vendorId: string, from?: string, to?: string): Promise<VendorAvailabilitySlot[]> {
    const window = this.window();
    const start = from && from > window.from ? from : window.from;
    const end = to && to < window.to ? to : window.to;

    return this.slots.find({
      where: { vendorId, date: Between(start, end) },
      order: { date: 'ASC', startTime: 'ASC' },
    });
  }

  /**
   * The buyer's view: only what can actually be booked.
   *
   * A blocked or booked window is simply absent rather than shown greyed out —
   * the buyer is choosing a time, and a list of times they cannot have is noise.
   */
  async listBookable(vendorId: string, from?: string, to?: string): Promise<VendorAvailabilitySlot[]> {
    const all = await this.list(vendorId, from, to);
    return all.filter((slot) => slot.status === SlotStatus.AVAILABLE && slot.booked < slot.capacity);
  }

  async summary(vendorId: string, from?: string, to?: string): Promise<AvailabilitySummary> {
    const window = this.window();
    const start = from ?? window.from;
    const end = to ?? window.to;
    const slots = await this.list(vendorId, start, end);

    const count = (status: SlotStatus) => slots.filter((s) => s.status === status).length;
    return {
      from: start,
      to: end,
      totalSlots: slots.length,
      availableSlots: count(SlotStatus.AVAILABLE),
      pendingSlots: count(SlotStatus.PENDING),
      bookedSlots: count(SlotStatus.BOOKED),
      blockedSlots: count(SlotStatus.BLOCKED),
    };
  }

  /** Per-date rollup, for painting the calendar. */
  async calendar(vendorId: string, from?: string, to?: string) {
    const slots = await this.list(vendorId, from, to);
    const byDate = new Map<string, VendorAvailabilitySlot[]>();
    for (const slot of slots) {
      const list = byDate.get(slot.date) ?? [];
      list.push(slot);
      byDate.set(slot.date, list);
    }

    return [...byDate.entries()].map(([date, daySlots]) => {
      const bookable = daySlots.filter(
        (s) => s.status === SlotStatus.AVAILABLE && s.booked < s.capacity,
      ).length;
      const pending = daySlots.filter((s) => s.status === SlotStatus.PENDING).length;
      const booked = daySlots.filter((s) => s.status === SlotStatus.BOOKED).length;
      const blocked = daySlots.filter((s) => s.status === SlotStatus.BLOCKED).length;

      // The label the calendar cell shows. "Fully booked" and "blocked" read
      // very differently to a buyer, so they never collapse into one state.
      const state =
        daySlots.length === 0
          ? 'no_availability'
          : blocked === daySlots.length
            ? 'blocked'
            : bookable === 0
              ? 'fully_booked'
              : bookable < daySlots.length
                ? 'partially_booked'
                : 'available';

      return { date, state, total: daySlots.length, bookable, pending, booked, blocked };
    });
  }

  // ------------------------------------------------------- booking side

  /**
   * Holds a slot for a booking request, inside the caller's transaction.
   *
   * The row is locked for update, so two buyers requesting the last window at
   * the same moment serialise here and the second is refused. Checking first and
   * writing afterwards would let both through, which for a wedding vendor is the
   * one failure with no recovery.
   */
  async reserve(
    manager: EntityManager,
    slotId: string,
    bookingId: string,
  ): Promise<VendorAvailabilitySlot> {
    const repo = manager.getRepository(VendorAvailabilitySlot);
    const slot = await repo.findOne({ where: { id: slotId }, lock: { mode: 'pessimistic_write' } });
    if (!slot) throw new NotFoundException('That time slot no longer exists');

    if (slot.status !== SlotStatus.AVAILABLE || slot.booked >= slot.capacity) {
      throw new BadRequestException('That time slot is no longer available');
    }

    slot.status = SlotStatus.PENDING;
    slot.bookingId = bookingId;
    return repo.save(slot);
  }

  /** The request became a confirmed booking. */
  async confirm(manager: EntityManager, slotId: string): Promise<void> {
    const repo = manager.getRepository(VendorAvailabilitySlot);
    const slot = await repo.findOne({ where: { id: slotId }, lock: { mode: 'pessimistic_write' } });
    if (!slot) return;

    slot.booked += 1;
    slot.status = slot.booked >= slot.capacity ? SlotStatus.BOOKED : SlotStatus.AVAILABLE;
    await repo.save(slot);
  }

  /**
   * The request ended without a booking — rejected, cancelled or expired. The
   * window goes back on sale; the row itself stays.
   */
  async release(slotId: string, wasConfirmed: boolean): Promise<void> {
    const slot = await this.slots.findOne({ where: { id: slotId } });
    if (!slot) return;

    if (wasConfirmed && slot.booked > 0) slot.booked -= 1;
    slot.status = slot.booked >= slot.capacity ? SlotStatus.BOOKED : SlotStatus.AVAILABLE;
    slot.bookingId = null;
    await this.slots.save(slot);
  }

  /** Is this slot still open, and does it belong to this vendor? */
  async isBookable(vendorId: string, slotId: string): Promise<boolean> {
    const slot = await this.slots.findOne({ where: { id: slotId, vendorId } });
    if (!slot) return false;
    return slot.status === SlotStatus.AVAILABLE && slot.booked < slot.capacity;
  }

  async findSlot(slotId: string): Promise<VendorAvailabilitySlot | null> {
    return this.slots.findOne({ where: { id: slotId } });
  }

  /** Slots attached to these bookings, for rendering a booking list. */
  async findByBookings(bookingIds: string[]): Promise<VendorAvailabilitySlot[]> {
    if (bookingIds.length === 0) return [];
    return this.slots.find({ where: { bookingId: In(bookingIds) } });
  }

  // ------------------------------------------------------------- guards

  private assertWithinWindow(date: string): void {
    const { from, to } = this.window();
    if (date < from) {
      throw new BadRequestException('Availability cannot be published for a date in the past');
    }
    if (date > to) {
      throw new BadRequestException(
        `Availability runs three months ahead — the latest date you can publish is ${to}`,
      );
    }
  }

  private assertTimeOrder(startTime: string, endTime: string): void {
    if (startTime >= endTime) {
      throw new BadRequestException('The start time must be before the end time');
    }
  }

  /**
   * Back-to-back slots are fine — 12:00–16:00 then 16:00–20:00 is a normal
   * working day. Genuine overlap is not.
   */
  private async assertNoOverlap(
    vendorId: string,
    date: string,
    startTime: string,
    endTime: string,
    excludeSlotId?: string,
  ): Promise<void> {
    const sameDay = await this.slots.find({ where: { vendorId, date } });
    const clash = sameDay.find(
      (slot) =>
        slot.id !== excludeSlotId &&
        slot.status !== SlotStatus.CANCELLED &&
        startTime < slot.endTime &&
        endTime > slot.startTime,
    );
    if (clash) {
      throw new BadRequestException(
        `That overlaps your ${clash.startTime.slice(0, 5)}–${clash.endTime.slice(0, 5)} slot on ${date}`,
      );
    }
  }

  private async loadOrFail(vendorId: string, slotId: string): Promise<VendorAvailabilitySlot> {
    const slot = await this.slots.findOne({ where: { id: slotId, vendorId } });
    if (!slot) throw new NotFoundException('Slot not found');
    return slot;
  }

  private async assertOwner(actor: AuthUser, vendorId: string): Promise<void> {
    if (actor.role === UserRole.ADMIN) return;
    const vendor = await this.vendors.findOne({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    if (vendor.ownerUserId !== actor.userId) {
      throw new ForbiddenException('This listing does not belong to you');
    }
  }
}
