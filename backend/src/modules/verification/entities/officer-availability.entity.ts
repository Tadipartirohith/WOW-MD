import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { OfficerAvailabilityStatus } from '../../../common/enums';

/**
 * Whether a verification officer is taking new fieldwork right now.
 *
 * One row per officer, keyed by the user id — an officer either is or is not on
 * leave, so this is a single fact about them rather than a history, and a table
 * keyed by userId keeps it out of the users table (which no verification code
 * owns) without pretending a 1:many shape it does not have.
 *
 * The row is created lazily the first time an officer sets anything; an officer
 * with no row has never touched availability and is treated as AVAILABLE.
 */
@Entity('officer_availability')
export class OfficerAvailability {
  @PrimaryColumn('uuid')
  officerUserId: string;

  @Column({ type: 'varchar', length: 16, default: OfficerAvailabilityStatus.AVAILABLE })
  status: OfficerAvailabilityStatus;

  /**
   * The leave window, both dates or neither. Kept even while AVAILABLE would be
   * pointless, so the two are cleared whenever the status leaves ON_LEAVE — the
   * allocator and the admin both read "on leave until" straight off these, and
   * a stale window under an available officer would read as a live one.
   */
  @Column({ type: 'date', nullable: true })
  leaveFrom: string | null;

  @Column({ type: 'date', nullable: true })
  leaveTo: string | null;

  @Column({ type: 'text', nullable: true })
  leaveReason: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** The officer's availability as anyone reading a roster wants it. */
export interface AvailabilityView {
  status: OfficerAvailabilityStatus;
  leaveFrom: string | null;
  leaveTo: string | null;
  leaveReason: string | null;
  /** Whether allocation should skip them right now. */
  onLeaveNow: boolean;
}

/**
 * Today as a bare `YYYY-MM-DD`, which is exactly what a `date` column stores.
 *
 * The platform's local date, not UTC. `toISOString` is UTC, and east of
 * Greenwich the two are different days for part of every night: an officer in
 * India booking leave for today at half past midnight was told the date had
 * already passed, because the server was still on yesterday (EZ1-I256). The
 * clients compute their floor the same way, so the date a picker offers and the
 * date the server will accept are the same date.
 */
export function todayIso(now: Date = new Date(), timeZone: string = PLATFORM_TIME_ZONE): string {
  /*
   * In the platform's timezone, not the process's. The server runs in UTC, so
   * its local date was still yesterday until half past five in the morning in
   * India -- the very case this function exists for. `en-CA` formats a date
   * as YYYY-MM-DD.
   */
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** The timezone "today" is decided in. The platform's users are in India. */
const PLATFORM_TIME_ZONE = process.env.APP_TIMEZONE || 'Asia/Kolkata';

/**
 * Whether an officer is out of allocation *today*.
 *
 * UNAVAILABLE is open-ended and always counts. ON_LEAVE only counts while today
 * falls inside the window, so a leave booked for next week does not quietly
 * remove the officer now — the whole reason the window is two dates. Date
 * strings compare correctly because `YYYY-MM-DD` sorts chronologically.
 */
export function isOnLeaveNow(
  a: Pick<OfficerAvailability, 'status' | 'leaveFrom' | 'leaveTo'> | null | undefined,
  today: string = todayIso(),
): boolean {
  if (!a) return false;
  if (a.status === OfficerAvailabilityStatus.UNAVAILABLE) return true;
  if (a.status === OfficerAvailabilityStatus.ON_LEAVE) {
    if (a.leaveFrom && today < a.leaveFrom) return false;
    if (a.leaveTo && today > a.leaveTo) return false;
    return true;
  }
  return false;
}

/** A row (or its absence) as the view above. No row means never set, so AVAILABLE. */
export function availabilityView(a: OfficerAvailability | null | undefined): AvailabilityView {
  return {
    status: a?.status ?? OfficerAvailabilityStatus.AVAILABLE,
    leaveFrom: a?.leaveFrom ?? null,
    leaveTo: a?.leaveTo ?? null,
    leaveReason: a?.leaveReason ?? null,
    onLeaveNow: isOnLeaveNow(a),
  };
}
