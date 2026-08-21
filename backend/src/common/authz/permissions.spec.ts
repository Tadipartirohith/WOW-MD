import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, ROLE_PERMISSIONS, permissionsFor, roleHasPermission } from './permissions';
import { PermissionsGuard } from '../guards/permissions.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import {
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

  /**
   * The wedding marketplace belongs to the couple.
   *
   * Narrowed from "consumers buy" to "individuals buy": an agency introduces
   * two families and is paid for that, and once the match is fixed the couple
   * hires their own vendors and holds their own escrow. The agent keeps the
   * one payment surface that is genuinely theirs — settling an agency fee.
   */
  it('lets only individual roles create bookings', () => {
    for (const role of INDIVIDUAL_ROLES) {
      expect(roleHasPermission(role, Permission.BOOKING_CREATE)).toBe(true);
    }
    for (const role of [...PROVIDER_ROLES, UserRole.AGENT]) {
      expect(roleHasPermission(role, Permission.BOOKING_CREATE)).toBe(false);
      expect(roleHasPermission(role, Permission.BOOKING_PAY)).toBe(false);
    }
    expect(roleHasPermission(UserRole.AGENT, Permission.AGENCY_FEE_PAY)).toBe(true);
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

  // Stewardship: building a profile for somebody who has no account.
  it('gives profile stewardship to agents and family members only', () => {
    for (const role of [UserRole.AGENT, UserRole.FAMILY]) {
      expect(roleHasPermission(role, Permission.MANAGED_PROFILE_MANAGE)).toBe(true);
      expect(roleHasPermission(role, Permission.MANAGED_PROFILE_INVITE)).toBe(true);
      expect(roleHasPermission(role, Permission.ACT_ON_BEHALF)).toBe(true);
    }
    for (const role of [UserRole.BRIDE, UserRole.GROOM, ...PROVIDER_ROLES]) {
      expect(roleHasPermission(role, Permission.MANAGED_PROFILE_MANAGE)).toBe(false);
      expect(roleHasPermission(role, Permission.MANAGED_PROFILE_INVITE)).toBe(false);
    }
  });

  // A family member stewards relatives but does not run an agency.
  it('keeps the agency surface to agents', () => {
    expect(roleHasPermission(UserRole.FAMILY, Permission.AGENCY_MANAGE)).toBe(false);
    expect(roleHasPermission(UserRole.FAMILY, Permission.CLIENT_CREATE)).toBe(false);
    expect(roleHasPermission(UserRole.AGENT, Permission.AGENCY_MANAGE)).toBe(true);
  });

  it('lets every self-registerable role manage its own sessions and 2FA', () => {
    for (const role of SELF_REGISTERABLE_ROLES) {
      expect(roleHasPermission(role, Permission.SESSION_MANAGE_OWN)).toBe(true);
      expect(roleHasPermission(role, Permission.MFA_MANAGE_OWN)).toBe(true);
    }
  });

  it('keeps agent approval and the audit trail to admins', () => {
    for (const role of SELF_REGISTERABLE_ROLES) {
      expect(roleHasPermission(role, Permission.ADMIN_AGENT_APPROVE)).toBe(false);
      expect(roleHasPermission(role, Permission.ADMIN_AUDIT_READ)).toBe(false);
    }
    expect(roleHasPermission(UserRole.ADMIN, Permission.ADMIN_AGENT_APPROVE)).toBe(true);
    expect(roleHasPermission(UserRole.ADMIN, Permission.ADMIN_AUDIT_READ)).toBe(true);
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

  /**
   * The guard reads two metadata keys — the @Public() marker first, then the
   * required permissions — so the mock has to answer per key rather than
   * returning one value for both.
   */
  const meta = (opts: { isPublic?: boolean; permissions?: Permission[] }) => {
    (reflector.getAllAndOverride as jest.Mock).mockImplementation((key: string) =>
      key === IS_PUBLIC_KEY ? opts.isPublic : opts.permissions,
    );
  };

  beforeEach(() => jest.clearAllMocks());

  it('allows a route with no permission metadata', () => {
    meta({});
    expect(guard.canActivate(ctx(undefined))).toBe(true);
  });

  // Signed-token routes such as the guest RSVP link and the invitation landing
  // page sit on controllers that carry a class-level @RequirePermissions.
  it('lets @Public() win over class-level permissions', () => {
    meta({ isPublic: true, permissions: [Permission.EVENT_MANAGE_OWN] });
    expect(guard.canActivate(ctx(undefined))).toBe(true);
  });

  it('allows a caller holding the required permission', () => {
    meta({ permissions: [Permission.BOOKING_CREATE] });
    expect(guard.canActivate(ctx({ userId: 'u1', role: UserRole.BRIDE }))).toBe(true);
  });

  it('rejects a caller missing the required permission', () => {
    meta({ permissions: [Permission.BOOKING_CREATE] });
    expect(() => guard.canActivate(ctx({ userId: 'v1', role: UserRole.VENDOR }))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects an unauthenticated caller on a guarded route', () => {
    meta({ permissions: [Permission.BOOKING_CREATE] });
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });

  it('requires every listed permission, not just one', () => {
    meta({ permissions: [Permission.BOOKING_CREATE, Permission.ADMIN_USERS_READ] });
    expect(() => guard.canActivate(ctx({ userId: 'u1', role: UserRole.BRIDE }))).toThrow(
      ForbiddenException,
    );
  });
});
