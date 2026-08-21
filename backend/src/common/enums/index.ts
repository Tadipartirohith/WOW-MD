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
  /**
   * Field verification and support staff. Accounts are created by an
   * administrator only — there is deliberately no self-registration path,
   * because this role decides whether other people get operational access.
   */
  IN_PERSON = 'in_person',
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
  /** The sender took the request back before it was answered. */
  WITHDRAWN = 'withdrawn',
  /** Previously accepted, then ended by one side. */
  UNMATCHED = 'unmatched',
  /** One side blocked the other; excluded from all future matching. */
  BLOCKED = 'blocked',
}

export enum VendorCategory {
  VENUE = 'venue',
  CATERING = 'catering',
  PHOTOGRAPHY = 'photography',
  DECOR = 'decor',
  MAKEUP = 'makeup',
  ENTERTAINMENT = 'entertainment',
  /**
   * A wedding needs trades nobody thought to list — transport, priests,
   * mehendi, fireworks. `OTHER` keeps them on the platform instead of turning
   * them away, and `otherCategory` records what they actually do so the list
   * can grow from evidence rather than guesswork.
   */
  OTHER = 'other',
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

/**
 * The service booking lifecycle.
 *
 * Two paths lead to payment. A quotation-driven booking goes
 * REQUESTED -> QUOTATION_SENT -> QUOTATION_ACCEPTED, which is how a vendor
 * prices a real wedding job. A listed-price booking skips straight to
 * PAYMENT_PENDING. Both then converge: money into escrow (PENDING), provider
 * confirms, work starts, work completes.
 *
 * PENDING keeps its original meaning — escrow is held and the provider has not
 * yet confirmed — so existing rows and clients are unaffected.
 */
export enum BookingStatus {
  /** Request received. The provider has been asked and has not priced it yet. */
  REQUESTED = 'requested',
  QUOTATION_SENT = 'quotation_sent',
  QUOTATION_ACCEPTED = 'quotation_accepted',
  /** The provider has agreed to the job. Waiting on the advance. */
  PAYMENT_PENDING = 'payment_pending',
  /**
   * Historic only. Before the milestone lifecycle this meant "escrow held,
   * awaiting the provider" — kept so old rows still load, never entered now.
   */
  PENDING = 'pending',
  /** Advance held in escrow. The provider may start. */
  CONFIRMED = 'confirmed',
  /** The provider has started. Cancelling from here is a dispute risk. */
  IN_PROGRESS = 'in_progress',
  /**
   * The provider says the work is done and the balance is now payable. The
   * booking is not complete until the buyer pays it — which is the whole point
   * of holding the last instalment back.
   */
  COMPLETED_PENDING_FINAL_PAYMENT = 'completed_pending_final_payment',
  COMPLETED = 'completed',
  /** An open case is holding the money. Only a settlement moves it. */
  DISPUTED = 'disputed',
  CANCELLED = 'cancelled',
}

/** Where a quotation stands. Only one may be live on a booking at a time. */
export enum QuotationStatus {
  SENT = 'sent',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  /** Past `validUntil`. Re-quoting supersedes rather than revives. */
  EXPIRED = 'expired',
  /** Replaced by a newer quotation on the same booking. */
  SUPERSEDED = 'superseded',
}

/** What an agent is charging for. */
export enum AgentChargeType {
  /** Onboarding fee for building and running a client profile. */
  PROFILE_CREATION = 'profile_creation',
  /** Success fee, due once the match is fixed. */
  MATCH_SETTLEMENT = 'match_settlement',
}

/**
 * Which government identity document a profile was verified against.
 *
 * Aadhaar is the common one in this market, but insisting on it would shut out
 * anyone who has not enrolled, so the alternatives are first-class.
 */
export enum GovernmentIdType {
  AADHAAR = 'aadhaar',
  PASSPORT = 'passport',
  VOTER_ID = 'voter_id',
  DRIVING_LICENCE = 'driving_licence',
  PAN = 'pan',
}

/**
 * Where a bookable window stands.
 *
 * PENDING is the important one: it is held between a booking request and the
 * decision on it, so a second buyer cannot take the same window while the first
 * is waiting on a quotation.
 */
export enum SlotStatus {
  AVAILABLE = 'available',
  PENDING = 'pending',
  BOOKED = 'booked',
  BLOCKED = 'blocked',
  CANCELLED = 'cancelled',
}

/** Lifecycle of a profile an agency maintains. */
export enum ProfileLifecycle {
  ACTIVE = 'active',
  /** Paused by the client or the agency; invisible to matchmaking. */
  DEACTIVATED = 'deactivated',
  /** Closed out. Kept for the record, never matched, never circulated. */
  ARCHIVED = 'archived',
}

export enum PaymentStatus {
  INITIATED = 'initiated',
  HELD_IN_ESCROW = 'held_in_escrow',
  /**
   * Frozen by an open case. Money in this state cannot be released or refunded
   * by the normal booking transitions — only a recorded settlement decision
   * moves it, which is what makes escrow more than a label.
   */
  DISPUTED = 'disputed',
  RELEASED = 'released',
  REFUNDED = 'refunded',
  /** Partially settled: some released, the remainder refunded. */
  PARTIALLY_SETTLED = 'partially_settled',
  FAILED = 'failed',
}

/**
 * Escrow is collected in stages rather than up front, which is how wedding
 * vendors are actually paid: something to hold the date, something as the
 * event approaches, and the balance on delivery.
 */
export enum PaymentMilestone {
  ADVANCE = 'advance',
  SECOND = 'second',
  FINAL = 'final',
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

/** Who a verification request is about. */
export enum ApplicantType {
  AGENT = 'agent',
  VENDOR = 'vendor',
}

/**
 * Lifecycle of a verification request.
 *
 * NEW and ASSIGNED are administrative; the rest are decisions recorded by the
 * verifier. ISSUE and ADDITIONAL_REVIEW both block activation without being
 * outright rejections, which is what the business needs for "we found a
 * discrepancy" versus "we are not satisfied".
 */
export enum VerificationStatus {
  NEW = 'new',
  ASSIGNED = 'assigned',
  IN_PROGRESS = 'in_progress',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ISSUE = 'issue',
  ADDITIONAL_REVIEW = 'additional_review',
}

/** What a support or investigation case is attached to. */
export enum CaseSubject {
  AGENT = 'agent',
  VENDOR = 'vendor',
  PROFILE = 'profile',
  MATCH = 'match',
  BOOKING = 'booking',
  PAYMENT = 'payment',
  OTHER = 'other',
}

export enum CaseStatus {
  OPEN = 'open',
  ALLOCATED = 'allocated',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  REJECTED = 'rejected',
  ESCALATED = 'escalated',
  CLOSED = 'closed',
}

/**
 * How a case involving money was settled. Recorded on the case AND on the
 * payment, so a later audit can answer "who decided this, and when".
 */
export enum SettlementOutcome {
  RELEASE = 'release',
  REFUND = 'refund',
  PARTIAL = 'partial',
  NO_ACTION = 'no_action',
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

/**
 * The full match lifecycle the specification calls for.
 *
 * Beyond accept/reject there are four more terminal-ish states, each with a
 * different meaning for visibility: a WITHDRAWN request never reached the
 * recipient's decision, an UNMATCHED pair were matched and are no longer,
 * BLOCKED removes the pair from each other's matching entirely, and REPORTED
 * additionally raises a case.
 */
export enum MatchFixedState {
  /** Neither side has proposed fixing the match. */
  NONE = 'none',
  /** One side has proposed; the other has not yet confirmed. */
  PENDING_CONFIRMATION = 'pending_confirmation',
  /** Both sides confirmed. Customer accounts are provisioned from here. */
  CONFIRMED = 'confirmed',
}

/** Where an individual user is in the onboarding sequence. */
export enum OnboardingStage {
  /** Registered but the mandatory profile fields are incomplete. */
  PROFILE_INCOMPLETE = 'profile_incomplete',
  /** Profile complete; matchmaking is open. */
  MATCHMAKING_ACTIVE = 'matchmaking_active',
  /** Match fixed; matchmaking closed and services unlocked. */
  MATCH_FIXED = 'match_fixed',
}

/** Why a user is allowed to talk to another user outside of a match. */
export enum ThreadKind {
  MATCH = 'match',
  INQUIRY = 'inquiry',
  REPRESENTATION = 'representation',
}
