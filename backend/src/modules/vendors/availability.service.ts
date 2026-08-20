import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, Repository } from 'typeorm';
import { Vendor } from './entities/vendor.entity';
import { VendorAvailability } from './entities/vendor-availability.entity';
import { SetAvailabilityDto } from './dto/availability.dto';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums';

/**
 * A vendor's calendar, and the rule that stops the same date being sold twice.
 *
 * Double-booking is the failure a wedding vendor cannot recover from — there is
 * no rescheduling a wedding — so the capacity check runs inside the same
 * transaction that confirms the booking, with the row locked. Checking on the
 * way in and hoping nothing else confirms in between is exactly how two
 * families end up sharing a photographer.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    @InjectRepository(VendorAvailability)
    private readonly availability: Repository<VendorAvailability>,
    @InjectRepository(Vendor) private readonly vendors: Repository<Vendor>,
  ) {}

  /** The vendor sets, opens or blocks out a date. */
  async set(actor: AuthUser, vendorId: string, dto: SetAvailabilityDto): Promise<VendorAvailability> {
    await this.assertOwner(actor, vendorId);

    let row = await this.availability.findOne({ where: { vendorId, date: dto.date } });
    if (!row) {
      row = this.availability.create({ vendorId, date: dto.date, booked: 0 });
    }
    if (dto.capacity < row.booked) {
      throw new BadRequestException(
        `That date already has ${row.booked} confirmed booking(s); capacity cannot go below that.`,
      );
    }
    row.capacity = dto.capacity;
    row.note = dto.note ?? null;
    return this.availability.save(row);
  }

  /** The calendar as the vendor and the buyer both see it. */
  async list(vendorId: string, from?: string, to?: string): Promise<VendorAvailability[]> {
    const where =
      from && to ? { vendorId, date: Between(from, to) } : { vendorId };
    return this.availability.find({ where, order: { date: 'ASC' } });
  }

  /**
   * Is this date bookable?
   *
   * A date with no row is available: a vendor who has never touched their
   * calendar should still be bookable, and forcing them to enumerate every open
   * day before taking a single booking would be a worse default than the
   * occasional clash they resolve by hand.
   */
  async isAvailable(vendorId: string, date: string): Promise<boolean> {
    const row = await this.availability.findOne({ where: { vendorId, date } });
    if (!row) return true;
    return row.booked < row.capacity;
  }

  /**
   * Takes a slot on the date, inside the caller's transaction.
   *
   * The row is locked for update, so two bookings confirming for the same date
   * at the same moment serialise here and the second one is refused rather than
   * silently accepted.
   */
  async reserve(manager: EntityManager, vendorId: string, date: string): Promise<void> {
    const repo = manager.getRepository(VendorAvailability);
    const existing = await repo.findOne({
      where: { vendorId, date },
      lock: { mode: 'pessimistic_write' },
    });

    if (!existing) {
      // First booking on an untouched date: create the row already taken, so a
      // concurrent second booking finds it and blocks.
      await repo.insert({ vendorId, date, capacity: 1, booked: 1 });
      return;
    }
    if (existing.booked >= existing.capacity) {
      throw new BadRequestException('That date is no longer available with this vendor');
    }
    existing.booked += 1;
    await repo.save(existing);
  }

  /** Gives the slot back when a booking is cancelled. */
  async release(vendorId: string, date: string): Promise<void> {
    const row = await this.availability.findOne({ where: { vendorId, date } });
    if (!row || row.booked === 0) return;
    row.booked -= 1;
    await this.availability.save(row);
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
