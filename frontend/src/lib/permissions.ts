/**
 * Client-side mirror of the server permission matrix
 * (backend/src/common/authz/permissions.ts).
 *
 * This exists ONLY to shape navigation and hide controls a persona cannot use.
 * It is not a security boundary: the server re-checks every request, and the
 * signed-in user's real permission list arrives from /auth/me/permissions.
 * Keep the two files in step when adding a capability.
 */

export type UserRole = 'bride' | 'groom' | 'family' | 'agent' | 'vendor' | 'planner' | 'admin';

export type AccountType = 'individual' | 'agent' | 'vendor' | 'planner';

export const Permission = {
  PROFILE_MANAGE_OWN: 'profile:manage:own',
  MATCH_BROWSE: 'match:browse',
  MATCH_SEND_INTEREST: 'match:send_interest',
  MATCH_RESPOND_INTEREST: 'match:respond_interest',
  CHAT_MATCH: 'chat:match',
  CHAT_INQUIRE: 'chat:inquire',
  BOOKING_CREATE: 'booking:create',
  BOOKING_PAY: 'booking:pay',
  BOOKING_CANCEL_OWN: 'booking:cancel:own',
  BOOKING_READ_OWN: 'booking:read:own',
  BOOKING_CONFIRM: 'booking:confirm',
  BOOKING_COMPLETE: 'booking:complete',
  BOOKING_READ_INCOMING: 'booking:read:incoming',
  VENDOR_LISTING_MANAGE: 'vendor_listing:manage',
  PLANNER_LISTING_MANAGE: 'planner_listing:manage',
  REVIEW_WRITE: 'review:write',
  MANAGED_PROFILE_MANAGE: 'managed_profile:manage',
  MANAGED_PROFILE_INVITE: 'managed_profile:invite',
  ACT_ON_BEHALF: 'act_on_behalf',
  CLIENT_CREATE: 'client:create',
  CLIENT_READ: 'client:read',
  CLIENT_ACT_ON_BEHALF: 'client:act_on_behalf',
  AGENCY_MANAGE: 'agency:manage',
  PLAN_MANAGE_OWN: 'plan:manage:own',
  PLAN_MANAGE_ENGAGED: 'plan:manage:engaged',
  EVENT_MANAGE_OWN: 'event:manage:own',
  MEDIA_MANAGE_OWN: 'media:manage:own',
  TRAVEL_BOOK: 'travel:book',
  DISPUTE_RAISE: 'dispute:raise',
  AI_ASSIST: 'ai:assist',
  SESSION_MANAGE_OWN: 'session:manage:own',
  MFA_MANAGE_OWN: 'mfa:manage:own',
  ADMIN_USERS_READ: 'admin:users:read',
  ADMIN_AGENT_APPROVE: 'admin:agent:approve',
  ADMIN_AUDIT_READ: 'admin:audit:read',
  ADMIN_VENDOR_APPROVE: 'admin:vendor:approve',
  ADMIN_ANALYTICS_READ: 'admin:analytics:read',
  ADMIN_DISPUTE_RESOLVE: 'admin:dispute:resolve',
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

export const INDIVIDUAL_ROLES: UserRole[] = ['bride', 'groom', 'family'];

export const isIndividual = (role?: string) => INDIVIDUAL_ROLES.includes(role as UserRole);
export const isProvider = (role?: string) => role === 'vendor' || role === 'planner';

/** Roles that may build and manage a profile on somebody else's behalf. */
export const isSteward = (role?: string) => role === 'agent' || role === 'family';

/** Lifecycle of a profile built for someone who may have no account yet. */
export type ProfileClaimStatus = 'unclaimed' | 'invited' | 'claimed' | 'self';

export const CLAIM_STATUS_LABEL: Record<ProfileClaimStatus, string> = {
  unclaimed: 'Not yet invited',
  invited: 'Invitation sent',
  claimed: 'Claimed by owner',
  self: 'Self-managed',
};

/** Human-facing label for each persona. */
export const ROLE_LABEL: Record<UserRole, string> = {
  bride: 'Bride',
  groom: 'Groom',
  family: 'Family member',
  agent: 'Marriage agent',
  vendor: 'Vendor',
  planner: 'Wedding planner',
  admin: 'Administrator',
};

/** Does the signed-in user hold this capability? */
export function can(permissions: string[] | null | undefined, permission: PermissionValue): boolean {
  return Boolean(permissions?.includes(permission));
}

/** Does the user hold at least one of these? Used for nav entries. */
export function canAny(
  permissions: string[] | null | undefined,
  wanted: PermissionValue[],
): boolean {
  if (!permissions) return false;
  return wanted.some((p) => permissions.includes(p));
}
