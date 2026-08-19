/**
 * Account personas on the platform.
 *
 * Three "individual" personas (bride/groom/family) plus four organisational
 * personas. The individual personas are the ones that take part in
 * matchmaking; AGENT/VENDOR/PLANNER are business accounts with their own
 * consoles, and ADMIN is never self-registerable.
 */
export enum UserRole {
  BRIDE = 'bride',
  GROOM = 'groom',
  FAMILY = 'family',
  AGENT = 'agent',
  VENDOR = 'vendor',
  PLANNER = 'planner',
  ADMIN = 'admin',
}

/**
 * The coarse account type a visitor picks on the sign-up screen. INDIVIDUAL
 * expands into one of the bride/groom/family roles; the rest map 1:1.
 */
export enum AccountType {
  INDIVIDUAL = 'individual',
  AGENT = 'agent',
  VENDOR = 'vendor',
  PLANNER = 'planner',
}

/** Roles that take part in matchmaking (send/receive interests, be suggested). */
export const INDIVIDUAL_ROLES: readonly UserRole[] = [
  UserRole.BRIDE,
  UserRole.GROOM,
  UserRole.FAMILY,
] as const;

/** Roles that sell bookable services. */
export const PROVIDER_ROLES: readonly UserRole[] = [UserRole.VENDOR, UserRole.PLANNER] as const;

/** Roles allowed to place a booking (for themselves, or on a client's behalf). */
export const CONSUMER_ROLES: readonly UserRole[] = [...INDIVIDUAL_ROLES, UserRole.AGENT] as const;

/** Roles a visitor may choose at sign-up. ADMIN is provisioned out-of-band. */
export const SELF_REGISTERABLE_ROLES: readonly UserRole[] = [
  ...INDIVIDUAL_ROLES,
  UserRole.AGENT,
  UserRole.VENDOR,
  UserRole.PLANNER,
] as const;

export const isIndividual = (role: UserRole | string): boolean =>
  INDIVIDUAL_ROLES.includes(role as UserRole);
export const isProvider = (role: UserRole | string): boolean =>
  PROVIDER_ROLES.includes(role as UserRole);
export const isConsumer = (role: UserRole | string): boolean =>
  CONSUMER_ROLES.includes(role as UserRole);

/** Which concrete role an account type resolves to, for the non-individual types. */
export const ACCOUNT_TYPE_ROLE: Record<Exclude<AccountType, AccountType.INDIVIDUAL>, UserRole> = {
  [AccountType.AGENT]: UserRole.AGENT,
  [AccountType.VENDOR]: UserRole.VENDOR,
  [AccountType.PLANNER]: UserRole.PLANNER,
};

/** What kind of seller a booking points at. */
export enum ProviderType {
  VENDOR = 'vendor',
  PLANNER = 'planner',
}

export enum ProfileVisibility {
  PUBLIC = 'public',
  MATCHES_ONLY = 'matches_only',
  PRIVATE = 'private',
}

export enum InterestStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

export enum VendorCategory {
  VENUE = 'venue',
  CATERING = 'catering',
  PHOTOGRAPHY = 'photography',
  DECOR = 'decor',
  MAKEUP = 'makeup',
  ENTERTAINMENT = 'entertainment',
}

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
}

export enum NotificationType {
  MATCH_INTEREST = 'match_interest',
  MATCH_ACCEPTED = 'match_accepted',
  NEW_MESSAGE = 'new_message',
  TASK_REMINDER = 'task_reminder',
  BOOKING_UPDATE = 'booking_update',
}

export enum BookingStatus {
  REQUESTED = 'requested',
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum PaymentStatus {
  INITIATED = 'initiated',
  HELD_IN_ESCROW = 'held_in_escrow',
  RELEASED = 'released',
  REFUNDED = 'refunded',
  FAILED = 'failed',
}

export enum RsvpStatus {
  INVITED = 'invited',
  ATTENDING = 'attending',
  DECLINED = 'declined',
  MAYBE = 'maybe',
}

export enum DisputeStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
  REJECTED = 'rejected',
}

export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
}

/**
 * Lifecycle of a profile that an agent or family member built on someone
 * else's behalf. A profile can exist, be searchable and be matched long before
 * the person it describes has an account.
 */
export enum ProfileClaimStatus {
  /** Built by a steward; the subject has no account and has not been invited. */
  UNCLAIMED = 'unclaimed',
  /** An email invitation is outstanding. */
  INVITED = 'invited',
  /** The subject accepted the invitation and now owns the profile. */
  CLAIMED = 'claimed',
  /** Self-registered: the profile was created by its own owner. */
  SELF = 'self',
}

export enum InvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

/** Single-use email tokens that are not profile invitations. */
export enum EmailTokenType {
  VERIFY_EMAIL = 'verify_email',
  RESET_PASSWORD = 'reset_password',
}

/**
 * Consent is recorded in two scopes because they are genuinely different asks.
 * A family walking into an agency agrees to the agency holding their details;
 * that is not the same as agreeing to those details being passed around.
 */
export enum ConsentScope {
  /** Permission for the agency to hold and use the details internally. */
  INTAKE = 'intake',
  /** Permission to share the profile outside the agency. Re-confirmable. */
  CIRCULATION = 'circulation',
}

/** How the consent was obtained. Walk-ins are overwhelmingly the first two. */
export enum ConsentMethod {
  IN_PERSON = 'in_person',
  PHONE = 'phone',
  WRITTEN = 'written',
  DIGITAL = 'digital',
}

/**
 * Who actually gave it. In this market the subject frequently does not speak
 * for themselves — a parent hands over the biodata — so the relationship is
 * recorded rather than assumed.
 */
export enum ConsentRelation {
  SELF = 'self',
  FATHER = 'father',
  MOTHER = 'mother',
  GUARDIAN = 'guardian',
  SIBLING = 'sibling',
  OTHER = 'other',
}

/** Who a profile was circulated to. */
export enum ShareAudience {
  /** Another agent, who may propose a match from their own book. */
  AGENT = 'agent',
  /** A platform user with an account, shown the profile directly. */
  USER = 'user',
  /** A signed link, for sending to a family that has no account. */
  LINK = 'link',
}

/** Whether the profile is discoverable by the wider vetted-agent network. */
export enum NetworkVisibility {
  /** Only the owning agency, plus anyone explicitly shared with. */
  PRIVATE = 'private',
  /** Searchable by every approved agent. */
  POOL = 'pool',
}

/** Where a cross-agent pairing conversation has got to. */
export enum ProposalStatus {
  OPEN = 'open',
  AGREED = 'agreed',
  DECLINED = 'declined',
}

/**
 * Roles that may build and manage a profile for somebody else. Agents run a
 * book of business; family members look after one or two relatives. The
 * mechanics are identical, so both go through the same stewardship paths.
 */
export const STEWARD_ROLES: readonly UserRole[] = [UserRole.AGENT, UserRole.FAMILY] as const;

export const isSteward = (role: UserRole | string): boolean =>
  STEWARD_ROLES.includes(role as UserRole);

/** Why a user is allowed to talk to another user outside of a match. */
export enum ThreadKind {
  MATCH = 'match',
  INQUIRY = 'inquiry',
  REPRESENTATION = 'representation',
}
