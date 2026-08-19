import { SetMetadata } from '@nestjs/common';
import { Permission } from '../authz/permissions';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Declares the capabilities a route needs. All listed permissions must be held
 * (AND), which keeps the intent readable; use separate routes when you mean OR.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
