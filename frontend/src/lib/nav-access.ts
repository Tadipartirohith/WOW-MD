import type { UserRole } from './permissions';

/**
 * Who is refused a destination, asked once.
 *
 * Four places decided this and none of them agreed: the sidebar read `hideFor`
 * on the nav table, the dashboard read a different `hideFor` on its own tile
 * list, the route guard read neither and checked permissions only, and nothing
 * covered the administrator at all. So an officer with no Chat in the rail
 * still had a Messages tile on their dashboard and could still type /chat; a
 * planner had all three; and the admin console showed the whole of somebody
 * else's wedding.
 *
 * This is not a new rule. It is the rule those four were each trying to
 * express, in one place, so that adding a role to `hideFor` closes the link,
 * the tile and the address together.
 */

/**
 * What an administrator sees, as an allow-list.
 *
 * Every other entry is gated on capability, which works for every role but
 * this one: an administrator holds every permission in the system, so a
 * capability check can never keep them off a screen. That is why the console
 * offered Matches, Biodata, Interests, Client Profiles, Network Pool, Hire a
 * Planner, Honeymoon and Media — a wedding, to the person administering the
 * platform.
 *
 * An allow-list rather than the exclusions, because the exclusion list is the
 * longer one and grows with every screen added: the failure would then be
 * silent and in the wrong direction. A new screen is invisible to the admin
 * until somebody decides it belongs here.
 *
 * Users, Agents, Vendors, Catalog, Payments and Reports live inside /admin
 * today rather than as their own destinations. Splitting them out is the
 * console rebuild, not this.
 */
export const ADMIN_NAV = new Set([
  '/',
  '/admin',
  '/verification',
  '/bookings',
  '/accounts',
  '/support',
  '/notifications',
  '/security',
  '/profile',
]);

export interface Restricted {
  to: string;
  /** Roles that hold the permission but should not be offered the entry. */
  hideFor?: UserRole[];
}

export function navDenied(entry: Restricted, role: UserRole): boolean {
  if (entry.hideFor?.includes(role)) return true;
  return role === 'admin' && !ADMIN_NAV.has(entry.to);
}
