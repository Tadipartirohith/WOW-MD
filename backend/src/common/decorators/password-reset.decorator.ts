import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_PASSWORD_RESET = 'allowDuringPasswordReset';

/**
 * Marks a route as reachable by an account that still holds an emailed
 * temporary password.
 *
 * Only three things qualify: changing the password, signing out, and reading
 * your own permissions so the client knows where to send you. Marking anything
 * else would defeat the lock — the whole point is that a credential sent in
 * plain text can do nothing but replace itself.
 *
 * A decorator rather than a path list in the guard, because a path list is
 * silently wrong the moment a route moves or the global prefix changes, and
 * "silently wrong" here means either a locked-out user or an open door.
 */
export const AllowDuringPasswordReset = () => SetMetadata(ALLOW_DURING_PASSWORD_RESET, true);
