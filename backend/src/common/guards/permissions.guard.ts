import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Permission, permissionsFor } from '../authz/permissions';
import { AuthUser } from '../decorators/current-user.decorator';

/**
 * Capability check. Runs after JwtAuthGuard, so `request.user` is populated for
 * every non-public route.
 *
 * `@Public()` wins over any permission metadata, including a class-level
 * `@RequirePermissions`. That matters for routes such as the guest RSVP link
 * and the invitation landing page, which live on otherwise-guarded controllers
 * but are addressed by a signed token rather than a session.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!user) throw new ForbiddenException('Authentication required');

    const held = permissionsFor(user.role);
    const missing = required.filter((p) => !held.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Your account type (${user.role}) cannot perform this action. Missing: ${missing.join(', ')}`,
      );
    }
    return true;
  }
}
