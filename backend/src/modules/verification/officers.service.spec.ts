import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OfficersService } from './officers.service';
import { OfficerAvailability, todayIso } from './entities/officer-availability.entity';
import { User } from '../auth/entities/user.entity';
import { Profile } from '../users/entities/profile.entity';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../platform/mail/mail.service';
import { AuditService } from '../../platform/audit/audit.service';
import { OfficerAvailabilityStatus, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const officer: AuthUser = {
  userId: 'officer-1',
  email: 'officer@example.com',
  role: UserRole.IN_PERSON,
  managedByAgentId: null,
};

/** A date `days` either side of today, as the `YYYY-MM-DD` a date column holds. */
function offsetDay(days: number): string {
  const day = new Date();
  day.setDate(day.getDate() + days);
  return todayIso(day);
}

describe('OfficersService availability', () => {
  let service: OfficersService;
  let stored: OfficerAvailability | null = null;

  const availabilityRepo = {
    findOne: jest.fn(async () => stored),
    create: jest.fn((x: Partial<OfficerAvailability>) => ({ ...x }) as OfficerAvailability),
    save: jest.fn(async (x: OfficerAvailability) => {
      stored = x;
      return x;
    }),
    find: jest.fn(async () => []),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    stored = null;
    const moduleRef = await Test.createTestingModule({
      providers: [
        OfficersService,
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(Profile), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(OfficerAvailability), useValue: availabilityRepo },
        { provide: AppConfigService, useValue: {} as AppConfigService },
        { provide: MailService, useValue: {} as MailService },
        { provide: AuditService, useValue: { record: jest.fn() } as unknown as AuditService },
      ],
    }).compile();
    service = moduleRef.get(OfficersService);
  });

  const onLeave = (leaveFrom: string, leaveTo: string) => ({
    status: OfficerAvailabilityStatus.ON_LEAVE,
    leaveFrom,
    leaveTo,
  });

  it('takes a window that starts today', async () => {
    const view = await service.setAvailability(officer, onLeave(todayIso(), offsetDay(8)));
    expect(view.status).toBe(OfficerAvailabilityStatus.ON_LEAVE);
    expect(view.leaveFrom).toBe(todayIso());
  });

  it('takes a window entirely in the future', async () => {
    const view = await service.setAvailability(officer, onLeave(offsetDay(4), offsetDay(12)));
    expect(view.leaveFrom).toBe(offsetDay(4));
    expect(view.leaveTo).toBe(offsetDay(12));
  });

  it('refuses a start date in the past', async () => {
    await expect(
      service.setAvailability(officer, onLeave(offsetDay(-1), offsetDay(5))),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(availabilityRepo.save).not.toHaveBeenCalled();
  });

  // The example from the ticket: 16/09 to 15/09 is a window that ends before it
  // begins, whichever way round the dates were typed.
  it('refuses an end date before the start date', async () => {
    await expect(
      service.setAvailability(officer, onLeave(offsetDay(4), offsetDay(3))),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still refuses a half-set window', async () => {
    await expect(
      service.setAvailability(officer, {
        status: OfficerAvailabilityStatus.ON_LEAVE,
        leaveFrom: offsetDay(2),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /*
   * The record that already exists is not made unsaveable by the new rule. An
   * officer who went on leave last week and comes back to extend it, or to
   * write down why, is not setting a past date — they are keeping the one they
   * already had.
   */
  it('lets an officer keep a start date already on their record', async () => {
    const began = offsetDay(-6);
    stored = {
      officerUserId: officer.userId,
      status: OfficerAvailabilityStatus.ON_LEAVE,
      leaveFrom: began,
      leaveTo: offsetDay(1),
      leaveReason: null,
      updatedAt: new Date(),
    } as OfficerAvailability;

    const view = await service.setAvailability(officer, {
      ...onLeave(began, offsetDay(9)),
      leaveReason: 'Extended',
    });
    expect(view.leaveFrom).toBe(began);
    expect(view.leaveTo).toBe(offsetDay(9));
  });

  it('refuses a different past start date even when a row exists', async () => {
    stored = {
      officerUserId: officer.userId,
      status: OfficerAvailabilityStatus.ON_LEAVE,
      leaveFrom: offsetDay(-6),
      leaveTo: offsetDay(1),
      leaveReason: null,
      updatedAt: new Date(),
    } as OfficerAvailability;

    await expect(
      service.setAvailability(officer, onLeave(offsetDay(-3), offsetDay(5))),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // Every other status is an open-ended stand-down, so the window is cleared
  // rather than carried forward where it would read as live.
  it('clears the window when the officer comes back', async () => {
    await service.setAvailability(officer, onLeave(offsetDay(1), offsetDay(3)));
    const view = await service.setAvailability(officer, {
      status: OfficerAvailabilityStatus.AVAILABLE,
    });
    expect(view.leaveFrom).toBeNull();
    expect(view.leaveTo).toBeNull();
  });
});

describe('todayIso', () => {
  /*
   * The bug this was written for: east of Greenwich, `toISOString()` is still
   * on yesterday for the first hours of the local day, so leave booked for
   * today was refused as being in the past.
   */
  it('answers with the local date rather than the UTC one', () => {
    const earlyLocal = new Date(2026, 8, 16, 0, 30);
    expect(todayIso(earlyLocal)).toBe('2026-09-16');
  });

  it('pads month and day', () => {
    expect(todayIso(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });
});
