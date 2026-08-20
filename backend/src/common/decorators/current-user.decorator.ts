import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { UserRole } from '../enums';

export interface AuthUser {
  userId: string;
  email: string;
  role: UserRole;
  /** Present when this account was onboarded by an agent. */
  managedByAgentId: string | null;
  /**
   * True while a provisioned account still holds its emailed temporary
   * password. PasswordResetGuard refuses everything but the reset itself.
   */
  mustResetPassword?: boolean;
}

/** Extracts the authenticated user (set by JwtStrategy) from the request. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext): AuthUser[keyof AuthUser] | AuthUser | null => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthUser;
    return data ? (user?.[data] ?? null) : user;
  },
);
