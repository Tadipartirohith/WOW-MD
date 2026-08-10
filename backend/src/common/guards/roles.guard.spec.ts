import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../enums';

const makeContext = (user: unknown): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(makeContext({ role: UserRole.BRIDE }))).toBe(true);
  });

  it('allows when user has a required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.VENDOR]);
    expect(guard.canActivate(makeContext({ role: UserRole.VENDOR }))).toBe(true);
  });

  it('denies when user lacks the required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    expect(() => guard.canActivate(makeContext({ role: UserRole.BRIDE }))).toThrow(
      ForbiddenException,
    );
  });
});
