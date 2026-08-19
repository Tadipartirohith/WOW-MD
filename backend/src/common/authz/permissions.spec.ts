import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, ROLE_PERMISSIONS, permissionsFor, roleHasPermission } from './permissions';
import { PermissionsGuard } from '../guards/permissions.guard';
import {
  CONSUMER_ROLES,
  INDIVIDUAL_ROLES,
  PROVIDER_ROLES,
  SELF_REGISTERABLE_ROLES,
  UserRole,
} from '../enums';

describe('permission matrix', () => {
  it('covers every role', () => {
    for (const role of Object.values(UserRole)) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(permissionsFor(role).length).toBeGreaterThan(0);
    }
  });

  it('gives admin every permission', () => {
    for (const permission of Object.values(Permission)) {
      expect(roleHasPermission(UserRole.ADMIN, permission)).toBe(true);
    }
  });

  it('grants no permissions to an unknown role', () => {
    expect(permissionsFor('superuser')).toEqual([]);
  });

  it('never exposes admin capabilities to a self-registerable role', () => {
    const adminOnly = [
      Permission.ADMIN_USERS_READ,
      Permission.ADMIN_VENDOR_APPROVE,
      Permission.ADMIN_ANALYTICS_READ,
      Permission.ADMIN_DISPUTE_RESOLVE,
    ];
    for (const role of SELF_REGISTERABLE_ROLES) {
      for (const permission of adminOnly) {
        expect(roleHasPermission(role, permission)).toBe(false);
      }
    }
  });

  // The core separation the product asks for: only users and agents buy.
  it('lets only consumer roles create bookings', () => {
    for (const role of CONSUMER_ROLES) {
      expect(roleHasPermission(role, Permission.BOOKING_CREATE)).toBe(true);
    }
    for (const role of PROVIDER_ROLES) {
      expect(roleHasPermission(role, Permission.BOOKING_CREATE)).toBe(false);
      expect(roleHasPermission(role, Permission.BOOKING_PAY)).toBe(false);
    }
  });

  it('lets only provider roles confirm and complete bookings', () => {
    for (const role of PROVIDER_ROLES) {
      expect(roleHasPermission(role, Permission.BOOKING_CONFIRM)).toBe(true);
      expect(roleHasPermission(role, Permission.BOOKING_COMPLETE)).toBe(true);
    }
    for (const role of INDIVIDUAL_ROLES) {
      expect(roleHasPermission(role, Permission.BOOKING_CONFIRM)).toBe(false);
      expect(roleHasPermission(role, Permission.BOOKING_COMPLETE)).toBe(false);
    }
  });

  it('keeps providers out of matchmaking', () => {
    for (const role of PROVIDER_ROLES) {
      expect(roleHasPermission(role, Permission.MATCH_BROWSE)).toBe(false);
      expect(roleHasPermission(role, Permission.MATCH_SEND_INTEREST)).toBe(false);
    }
  });

  it('gives client management to agents alone', () => {
    expect(roleHasPermission(UserRole.AGENT, Permission.CLIENT_CREATE)).toBe(true);
    for (const role of [...INDIVIDUAL_ROLES, ...PROVIDER_ROLES]) {
      expect(roleHasPermission(role, Permission.CLIENT_CREATE)).toBe(false);
      expect(roleHasPermission(role, Permission.CLIENT_ACT_ON_BEHALF)).toBe(false);
    }
  });

  it('gives listing management only to the matching provider role', () => {
    expect(roleHasPermission(UserRole.VENDOR, Permission.VENDOR_LISTING_MANAGE)).toBe(true);
    expect(roleHasPermission(UserRole.VENDOR, Permission.PLANNER_LISTING_MANAGE)).toBe(false);
    expect(roleHasPermission(UserRole.PLANNER, Permission.PLANNER_LISTING_MANAGE)).toBe(true);
    expect(roleHasPermission(UserRole.PLANNER, Permission.VENDOR_LISTING_MANAGE)).toBe(false);
  });
});

describe('PermissionsGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const guard = new PermissionsGuard(reflector);

  const ctx = (user: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as unknown as ExecutionContext;

  beforeEach(() => jest.clearAllMocks());

  it('allows a route with no permission metadata', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    expect(guard.canActivate(ctx(undefined))).toBe(true);
  });

  it('allows a caller holding the required permission', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([Permission.BOOKING_CREATE]);
    expect(guard.canActivate(ctx({ userId: 'u1', role: UserRole.BRIDE }))).toBe(true);
  });

  it('rejects a caller missing the required permission', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([Permission.BOOKING_CREATE]);
    expect(() => guard.canActivate(ctx({ userId: 'v1', role: UserRole.VENDOR }))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects an unauthenticated caller on a guarded route', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([Permission.BOOKING_CREATE]);
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });

  it('requires every listed permission, not just one', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
      Permission.BOOKING_CREATE,
      Permission.ADMIN_USERS_READ,
    ]);
    expect(() => guard.canActivate(ctx({ userId: 'u1', role: UserRole.BRIDE }))).toThrow(
      ForbiddenException,
    );
  });
});
