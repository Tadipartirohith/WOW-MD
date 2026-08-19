import { UserRole } from '../enums';

/**
 * Capability catalogue. Controllers declare the *permission* they need rather
 * than a list of roles, so adding a persona is a one-line change to the matrix
 * below instead of a sweep across every controller.
 *
 * Naming: `<resource>:<action>`. `:own` suffixes mean the guard only proves the
 * caller may attempt the action; the service still checks record ownership.
 */
export enum Permission {
  // --- profile & matchmaking (individual personas) ---
  PROFILE_MANAGE_OWN = 'profile:manage:own',
  MATCH_BROWSE = 'match:browse',
  MATCH_SEND_INTEREST = 'match:send_interest',
  MATCH_RESPOND_INTEREST = 'match:respond_interest',

  // --- chat ---
  CHAT_MATCH = 'chat:match',
  CHAT_INQUIRE = 'chat:inquire',

  // --- bookings (buy side) ---
  BOOKING_CREATE = 'booking:create',
  BOOKING_PAY = 'booking:pay',
  BOOKING_CANCEL_OWN = 'booking:cancel:own',
  BOOKING_READ_OWN = 'booking:read:own',

  // --- bookings (sell side) ---
  BOOKING_CONFIRM = 'booking:confirm',
  BOOKING_COMPLETE = 'booking:complete',
  BOOKING_READ_INCOMING = 'booking:read:incoming',

  // --- listings ---
  VENDOR_LISTING_MANAGE = 'vendor_listing:manage',
  PLANNER_LISTING_MANAGE = 'planner_listing:manage',
  REVIEW_WRITE = 'review:write',

  // --- agent (brokerage) ---
  CLIENT_CREATE = 'client:create',
  CLIENT_READ = 'client:read',
  CLIENT_ACT_ON_BEHALF = 'client:act_on_behalf',

  // --- wedding planning workspace ---
  PLAN_MANAGE_OWN = 'plan:manage:own',
  PLAN_MANAGE_ENGAGED = 'plan:manage:engaged',

  // --- events, media, travel ---
  EVENT_MANAGE_OWN = 'event:manage:own',
  MEDIA_MANAGE_OWN = 'media:manage:own',
  TRAVEL_BOOK = 'travel:book',

  // --- support ---
  DISPUTE_RAISE = 'dispute:raise',
  AI_ASSIST = 'ai:assist',

  // --- administration ---
  ADMIN_USERS_READ = 'admin:users:read',
  ADMIN_VENDOR_APPROVE = 'admin:vendor:approve',
  ADMIN_ANALYTICS_READ = 'admin:analytics:read',
  ADMIN_DISPUTE_RESOLVE = 'admin:dispute:resolve',
}

/** Everything an individual (bride/groom/family) can do. */
const INDIVIDUAL_PERMISSIONS: Permission[] = [
  Permission.PROFILE_MANAGE_OWN,
  Permission.MATCH_BROWSE,
  Permission.MATCH_SEND_INTEREST,
  Permission.MATCH_RESPOND_INTEREST,
  Permission.CHAT_MATCH,
  Permission.CHAT_INQUIRE,
  Permission.BOOKING_CREATE,
  Permission.BOOKING_PAY,
  Permission.BOOKING_CANCEL_OWN,
  Permission.BOOKING_READ_OWN,
  Permission.REVIEW_WRITE,
  Permission.PLAN_MANAGE_OWN,
  Permission.EVENT_MANAGE_OWN,
  Permission.MEDIA_MANAGE_OWN,
  Permission.TRAVEL_BOOK,
  Permission.DISPUTE_RAISE,
  Permission.AI_ASSIST,
];

/**
 * Role to permission matrix. Deliberately explicit (no inheritance chains) so
 * that reading one row tells you exactly what a persona can reach.
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  [UserRole.BRIDE]: INDIVIDUAL_PERMISSIONS,
  [UserRole.GROOM]: INDIVIDUAL_PERMISSIONS,
  [UserRole.FAMILY]: INDIVIDUAL_PERMISSIONS,

  // Agents broker on behalf of the clients they onboard. They do NOT get a
  // matchmaking profile of their own, but they can browse and act for clients.
  [UserRole.AGENT]: [
    Permission.PROFILE_MANAGE_OWN,
    Permission.MATCH_BROWSE,
    Permission.MATCH_SEND_INTEREST,
    Permission.CHAT_INQUIRE,
    Permission.BOOKING_CREATE,
    Permission.BOOKING_PAY,
    Permission.BOOKING_CANCEL_OWN,
    Permission.BOOKING_READ_OWN,
    Permission.CLIENT_CREATE,
    Permission.CLIENT_READ,
    Permission.CLIENT_ACT_ON_BEHALF,
    Permission.PLAN_MANAGE_OWN,
    Permission.EVENT_MANAGE_OWN,
    Permission.MEDIA_MANAGE_OWN,
    Permission.TRAVEL_BOOK,
    Permission.DISPUTE_RAISE,
    Permission.AI_ASSIST,
    Permission.REVIEW_WRITE,
  ],

  // Vendors sell services. They cannot browse or book matchmaking.
  [UserRole.VENDOR]: [
    Permission.PROFILE_MANAGE_OWN,
    Permission.VENDOR_LISTING_MANAGE,
    Permission.BOOKING_CONFIRM,
    Permission.BOOKING_COMPLETE,
    Permission.BOOKING_READ_INCOMING,
    Permission.CHAT_INQUIRE,
    Permission.MEDIA_MANAGE_OWN,
    Permission.DISPUTE_RAISE,
    Permission.AI_ASSIST,
  ],

  // Wedding planners sell services AND co-manage the plans they are engaged on.
  [UserRole.PLANNER]: [
    Permission.PROFILE_MANAGE_OWN,
    Permission.PLANNER_LISTING_MANAGE,
    Permission.BOOKING_CONFIRM,
    Permission.BOOKING_COMPLETE,
    Permission.BOOKING_READ_INCOMING,
    Permission.CHAT_INQUIRE,
    Permission.PLAN_MANAGE_ENGAGED,
    Permission.EVENT_MANAGE_OWN,
    Permission.MEDIA_MANAGE_OWN,
    Permission.DISPUTE_RAISE,
    Permission.AI_ASSIST,
  ],

  // Admin gets every permission, computed rather than listed so new
  // permissions are never accidentally withheld from support staff.
  [UserRole.ADMIN]: Object.values(Permission),
};

export function permissionsFor(role: UserRole | string): readonly Permission[] {
  return ROLE_PERMISSIONS[role as UserRole] ?? [];
}

export function roleHasPermission(role: UserRole | string, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}
