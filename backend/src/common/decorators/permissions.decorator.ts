import { SetMetadata } from '@nestjs/common';
import { Permission } from '../authz/permissions';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Declares the capabilities a route needs. All listed permissions must be held
 * (AND), which keeps the intent readable; use separate routes when you mean OR.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const ANY_PERMISSIONS_KEY = 'any_permissions';

/**
 * Declares capabilities of which the caller needs at least ONE (OR).
 *
 * The AND form above is the right default and says "use separate routes when
 * you mean OR" -- which holds while the alternatives are different operations.
 * It stops holding when one operation is legitimately reachable by two
 * capabilities that mean different things about the *same* request: a couple
 * placing their own booking (booking:create) and a planner raising that same
 * request for a wedding they run (booking:request_for_client). Splitting those
 * into two routes would duplicate the whole create path -- validation, dedupe,
 * slot reservation, partner checks -- to vary one line, and the copies would
 * drift (EZ1-I235).
 *
 * Combines with RequirePermissions: everything in the AND list must be held,
 * and at least one of this list as well.
 */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);
