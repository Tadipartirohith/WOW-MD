import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_DURING_PASSWORD_RESET } from '../decorators/password-reset.decorator';
import { AuthUser } from '../decorators/current-user.decorator';

/** The client branches on this rather than on the message text. */
export const PASSWORD_RESET_REQUIRED = 'PASSWORD_RESET_REQUIRED';

/**
 * An account the platform provisioned after a Match Fixed starts with a
 * password that was emailed in the clear. Until it is replaced, that account
 * can do exactly two things: change the password, and sign out.
 *
 * Enforcing it here rather than in each controller is the point — a new route
 * added next month is covered without anyone remembering to think about it.
 */
@Injectable()
export class PasswordResetGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_PASSWORD_RESET, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!user?.mustResetPassword) return true;

    throw new ForbiddenException({
      message: 'Choose your own password before continuing.',
      code: PASSWORD_RESET_REQUIRED,
    });
  }
}
