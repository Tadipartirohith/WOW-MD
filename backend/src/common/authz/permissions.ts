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
  /** Withdraw, unmatch, block or report a match. */
  MATCH_LIFECYCLE = 'match:lifecycle',
  /** Confirm this side of a Match Fixed. Two of these close the match. */
  MATCH_FIX = 'match:fix',

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

  // --- stewardship: managing a profile for somebody else ---
  /** Build and edit a profile for a person who may have no account yet. */
  MANAGED_PROFILE_MANAGE = 'managed_profile:manage',
  /** Email an invitation so the subject can claim the profile. */
  MANAGED_PROFILE_INVITE = 'managed_profile:invite',
  /** Browse, send interests and book under a managed profile's identity. */
  ACT_ON_BEHALF = 'act_on_behalf',
  /** Circulate a profile: to an agent, to a user, as a link, or into the pool. */
  PROFILE_CIRCULATE = 'profile:circulate',
  /** Search profiles other agencies have put into the shared pool. */
  NETWORK_POOL_BROWSE = 'network_pool:browse',

  // --- agent (brokerage) ---
  CLIENT_CREATE = 'client:create',
  CLIENT_READ = 'client:read',
  CLIENT_ACT_ON_BEHALF = 'client:act_on_behalf',
  /** Maintain the agency's own registration record. */
  AGENCY_MANAGE = 'agency:manage',
  /**
   * Settle an agency fee. Held by the client who owes it and by the agency
   * recording a walk-in's payment — deliberately not `booking:pay`, which
   * belongs to the vendor marketplace an agent has no part in.
   */
  AGENCY_FEE_PAY = 'agency_fee:pay',

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

  // --- field verification and support cases ---
  /** See and work a verification queue. */
  VERIFICATION_PROCESS = 'verification:process',
  /** Record the approve/reject/issue decision on a request. */
  VERIFICATION_DECIDE = 'verification:decide',
  /**
   * Going out and writing it up: starting a visit and submitting findings.
   *
   * Split from `verification:process`, which now means only reading the queue.
   * An administrator needs to read every request to review one, and must not
   * be able to file the findings — an administrator writing up a visit nobody
   * made is the independent check silently not happening, and it is invisible
   * afterwards because the record looks the same either way.
   */
  VERIFICATION_FIELDWORK = 'verification:fieldwork',
  /**
   * Confirming an identity document, having seen it and the person together.
   *
   * Split from `verification:decide` for the opposite reason. This is the
   * officer's job and nobody else's — it is what the visit is for — while the
   * approve/reject decision on the resulting report is the administrator's.
   * One permission covering both made the officer the reviewer of their own
   * fieldwork.
   */
  IDENTITY_CONFIRM = 'identity:confirm',
  /** Assign a request or case to an officer. Admin only. */
  VERIFICATION_ALLOCATE = 'verification:allocate',
  CASE_RAISE = 'case:raise',
  CASE_ALLOCATE = 'case:allocate',
  CASE_INVESTIGATE = 'case:investigate',
  /** Decide release / refund / partial on disputed money. */
  CASE_SETTLE = 'case:settle',

  // --- account self-service ---
  SESSION_MANAGE_OWN = 'session:manage:own',
  MFA_MANAGE_OWN = 'mfa:manage:own',

  // --- administration ---
  ADMIN_USERS_READ = 'admin:users:read',
  ADMIN_AGENT_APPROVE = 'admin:agent:approve',
  /** Create and manage In-Person Verification accounts. Admin only. */
  ADMIN_OFFICER_MANAGE = 'admin:officer:manage',
  ADMIN_AUDIT_READ = 'admin:audit:read',
  ADMIN_VENDOR_APPROVE = 'admin:vendor:approve',
  ADMIN_ANALYTICS_READ = 'admin:analytics:read',
  ADMIN_DISPUTE_RESOLVE = 'admin:dispute:resolve',
  /**
   * Configure the service catalog: categories, service definitions, the
   * attributes that make up their forms, and which pricing models each
   * service may be sold on.
   *
   * Admin only, and deliberately separate from `ADMIN_VENDOR_APPROVE`. This is
   * the capability that decides what every vendor on the platform is able to
   * sell, so it is worth being able to grant one without the other.
   */
  CATALOG_MANAGE = 'catalog:manage',
}

/** Everything an individual (bride/groom/family) can do. */
const INDIVIDUAL_PERMISSIONS: Permission[] = [
  Permission.PROFILE_MANAGE_OWN,
  Permission.MATCH_BROWSE,
  Permission.MATCH_SEND_INTEREST,
  Permission.MATCH_RESPOND_INTEREST,
  Permission.MATCH_LIFECYCLE,
  Permission.MATCH_FIX,
  Permission.CHAT_MATCH,
  Permission.CHAT_INQUIRE,
  Permission.BOOKING_CREATE,
  Permission.BOOKING_PAY,
  Permission.BOOKING_CANCEL_OWN,
  Permission.BOOKING_READ_OWN,
  Permission.AGENCY_FEE_PAY,
  Permission.REVIEW_WRITE,
  Permission.PLAN_MANAGE_OWN,
  Permission.EVENT_MANAGE_OWN,
  Permission.MEDIA_MANAGE_OWN,
  Permission.TRAVEL_BOOK,
  Permission.DISPUTE_RAISE,
  Permission.CASE_RAISE,
  Permission.AI_ASSIST,
  Permission.SESSION_MANAGE_OWN,
  Permission.MFA_MANAGE_OWN,
];

/**
 * What an administrator is deliberately not given.
 *
 * Everything else is computed, so a new permission is never accidentally
 * withheld from support staff. These two are withheld on purpose, and the
 * reason is the same for both: they are done by somebody who was physically
 * present. An administrator who can submit findings can complete a
 * verification without anybody having visited, and an administrator who can
 * confirm an identity document can do it without having seen it — and neither
 * leaves any trace, because the record reads identically either way.
 *
 * This is the one place the admin's set is narrowed, so it is the one place to
 * look when asking why an administrator cannot do something.
 */
const NOT_THE_ADMINS_JOB: readonly Permission[] = [
  Permission.VERIFICATION_FIELDWORK,
  Permission.IDENTITY_CONFIRM,
];

/**
 * Role to permission matrix. Deliberately explicit (no inheritance chains) so
 * that reading one row tells you exactly what a persona can reach.
 */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  [UserRole.BRIDE]: INDIVIDUAL_PERMISSIONS,
  [UserRole.GROOM]: INDIVIDUAL_PERMISSIONS,

  // A family member is an individual who may ALSO look after a relative's
  // profile: a parent searching for their son, say. Mechanically that is the
  // same stewardship an agent does, so it reuses the same permissions — minus
  // the agency surface (no client accounts, no book of business).
  [UserRole.FAMILY]: [
    ...INDIVIDUAL_PERMISSIONS,
    Permission.MANAGED_PROFILE_MANAGE,
    Permission.MANAGED_PROFILE_INVITE,
    Permission.ACT_ON_BEHALF,
    // A family member may pass a relative's biodata around, but has no business
    // trawling other agencies' books.
    Permission.PROFILE_CIRCULATE,
  ],

  /**
   * Agents broker matches on behalf of the clients they onboard.
   *
   * Their surface is deliberately the brokerage and nothing else: no vendor or
   * planner directory, no bookings, no events, no travel. Those belong to the
   * couple, not to the agency that introduced them — and an agent holding
   * `booking:create` was the reason the wedding marketplace showed up in their
   * navigation at all.
   *
   * `client:act_on_behalf` still lets them run matchmaking under a client
   * identity; that is the whole job.
   */
  [UserRole.AGENT]: [
    Permission.PROFILE_MANAGE_OWN,
    Permission.MATCH_BROWSE,
    Permission.MATCH_SEND_INTEREST,
    Permission.MATCH_RESPOND_INTEREST,
    Permission.MATCH_LIFECYCLE,
    // An agent confirms Match Fixed for a client who has no account of their
    // own — for a walk-in family, the agent IS the client's interface.
    Permission.MATCH_FIX,
    Permission.CHAT_INQUIRE,
    Permission.CLIENT_CREATE,
    Permission.CLIENT_READ,
    Permission.CLIENT_ACT_ON_BEHALF,
    Permission.CASE_RAISE,
    Permission.AGENCY_MANAGE,
    Permission.AGENCY_FEE_PAY,
    Permission.MANAGED_PROFILE_MANAGE,
    Permission.MANAGED_PROFILE_INVITE,
    Permission.ACT_ON_BEHALF,
    Permission.PROFILE_CIRCULATE,
    Permission.NETWORK_POOL_BROWSE,
    Permission.SESSION_MANAGE_OWN,
    Permission.MFA_MANAGE_OWN,
    Permission.MEDIA_MANAGE_OWN,
    Permission.DISPUTE_RAISE,
    Permission.AI_ASSIST,

    /*
     * Verification is not the agent's job.
     *
     * Agents previously held VERIFICATION_PROCESS / VERIFICATION_FIELDWORK so
     * they could be allocated business visits, which put a Verification page in
     * their portal and let them reach /verification. Per the QA requirement
     * (EZ1-I20) verification is an internal officer/admin function only: the
     * page must not appear in the Agent Portal and agents must be refused the
     * endpoints. Removing the two permissions closes the nav entry, the route
     * guard and the API at once, since all three gate on exactly these.
     */
  ],

  // Vendors sell services. They cannot browse or book matchmaking.
  /**
   * A vendor sells into the marketplace and does nothing else on it.
   *
   * Wedding albums and the Genie assistant belong to the couple planning the
   * wedding, not to the caterer they hired — a vendor holding them saw two
   * menu entries that opened onto somebody else's wedding. Their own portfolio
   * lives on the listing, which `VENDOR_LISTING_MANAGE` already covers.
   */
  [UserRole.VENDOR]: [
    Permission.PROFILE_MANAGE_OWN,
    Permission.VENDOR_LISTING_MANAGE,
    Permission.BOOKING_CONFIRM,
    Permission.BOOKING_COMPLETE,
    Permission.BOOKING_READ_INCOMING,
    Permission.CHAT_INQUIRE,
    Permission.DISPUTE_RAISE,
    Permission.CASE_RAISE,
    Permission.SESSION_MANAGE_OWN,
    Permission.MFA_MANAGE_OWN,
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
    /*
     * MEDIA_MANAGE_OWN is deliberately absent.
     *
     * A planner had a "Media and Memories" module of their own, which is the
     * couple's module under another roof: the wedding photographs belong to
     * the people getting married, they already have a Media screen for them,
     * and two places to put the same album is how a family ends up asking
     * which one is the real one. A planner needing to add photographs to a
     * wedding they are engaged on should be doing it in that wedding's album,
     * which is a different feature from owning a second one.
     */
    Permission.DISPUTE_RAISE,
    Permission.CASE_RAISE,
    Permission.AI_ASSIST,
    Permission.SESSION_MANAGE_OWN,
    Permission.MFA_MANAGE_OWN,
  ],

  /**
   * Field verification and support staff.
   *
   * Deliberately narrow: they decide whether other people get operational
   * access, so they get the verification and case surface and nothing else —
   * no matchmaking, no listings, no bookings, and no ability to allocate work
   * to themselves.
   */
  [UserRole.IN_PERSON]: [
    Permission.PROFILE_MANAGE_OWN,
    Permission.VERIFICATION_PROCESS,
    Permission.VERIFICATION_FIELDWORK,
    Permission.IDENTITY_CONFIRM,
    Permission.CASE_RAISE,
    Permission.CASE_INVESTIGATE,
    Permission.CASE_SETTLE,
    Permission.CHAT_INQUIRE,
    Permission.SESSION_MANAGE_OWN,
    Permission.MFA_MANAGE_OWN,
  ],

  // Admin gets every permission bar the ones above, computed rather than
  // listed so new permissions are never accidentally withheld.
  [UserRole.ADMIN]: Object.values(Permission).filter(
    (p) => !NOT_THE_ADMINS_JOB.includes(p),
  ),
};

export function permissionsFor(role: UserRole | string): readonly Permission[] {
  return ROLE_PERMISSIONS[role as UserRole] ?? [];
}

export function roleHasPermission(role: UserRole | string, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}
