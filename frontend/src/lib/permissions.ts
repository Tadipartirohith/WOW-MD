/**
 * Client-side mirror of the server permission matrix
 * (backend/src/common/authz/permissions.ts).
 *
 * This exists ONLY to shape navigation and hide controls a persona cannot use.
 * It is not a security boundary: the server re-checks every request, and the
 * signed-in user's real permission list arrives from /auth/me/permissions.
 * Keep the two files in step when adding a capability.
 */

export type UserRole =
  | 'bride'
  | 'groom'
  | 'family'
  | 'agent'
  | 'vendor'
  | 'planner'
  | 'in_person'
  | 'admin';

export type AccountType = 'individual' | 'agent' | 'vendor' | 'planner';

export const Permission = {
  PROFILE_MANAGE_OWN: 'profile:manage:own',
  MATCH_BROWSE: 'match:browse',
  MATCH_SEND_INTEREST: 'match:send_interest',
  MATCH_RESPOND_INTEREST: 'match:respond_interest',
  MATCH_LIFECYCLE: 'match:lifecycle',
  MATCH_FIX: 'match:fix',
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
  PROFILE_CIRCULATE: 'profile:circulate',
  NETWORK_POOL_BROWSE: 'network_pool:browse',
  CLIENT_CREATE: 'client:create',
  CLIENT_READ: 'client:read',
  CLIENT_ACT_ON_BEHALF: 'client:act_on_behalf',
  AGENCY_MANAGE: 'agency:manage',
  AGENCY_FEE_PAY: 'agency_fee:pay',
  PLAN_MANAGE_OWN: 'plan:manage:own',
  PLAN_MANAGE_ENGAGED: 'plan:manage:engaged',
  EVENT_MANAGE_OWN: 'event:manage:own',
  MEDIA_MANAGE_OWN: 'media:manage:own',
  TRAVEL_BOOK: 'travel:book',
  DISPUTE_RAISE: 'dispute:raise',
  AI_ASSIST: 'ai:assist',
  SESSION_MANAGE_OWN: 'session:manage:own',
  MFA_MANAGE_OWN: 'mfa:manage:own',
  VERIFICATION_PROCESS: 'verification:process',
  VERIFICATION_DECIDE: 'verification:decide',
  VERIFICATION_ALLOCATE: 'verification:allocate',
  CASE_RAISE: 'case:raise',
  CASE_ALLOCATE: 'case:allocate',
  CASE_INVESTIGATE: 'case:investigate',
  CASE_SETTLE: 'case:settle',
  ADMIN_OFFICER_MANAGE: 'admin:officer:manage',
  ADMIN_USERS_READ: 'admin:users:read',
  ADMIN_AGENT_APPROVE: 'admin:agent:approve',
  ADMIN_AUDIT_READ: 'admin:audit:read',
  ADMIN_VENDOR_APPROVE: 'admin:vendor:approve',
  ADMIN_ANALYTICS_READ: 'admin:analytics:read',
  ADMIN_DISPUTE_RESOLVE: 'admin:dispute:resolve',
  CATALOG_MANAGE: 'catalog:manage',
} as const;

export type PermissionValue = (typeof Permission)[keyof typeof Permission];

export const INDIVIDUAL_ROLES: UserRole[] = ['bride', 'groom', 'family'];

export const isIndividual = (role?: string) => INDIVIDUAL_ROLES.includes(role as UserRole);
export const isProvider = (role?: string) => role === 'vendor' || role === 'planner';

/** Roles that may build and manage a profile on somebody else's behalf. */
export const isSteward = (role?: string) => role === 'agent' || role === 'family';

/** Lifecycle of a profile built for someone who may have no account yet. */
export type ProfileClaimStatus = 'unclaimed' | 'invited' | 'claimed' | 'self';

/** How a family gave permission, and who gave it. */
export type ConsentMethod = 'in_person' | 'phone' | 'written' | 'digital';
export type ConsentRelation = 'self' | 'father' | 'mother' | 'guardian' | 'sibling' | 'other';

export const CONSENT_METHOD_LABEL: Record<ConsentMethod, string> = {
  in_person: 'In person, at the office',
  phone: 'Over the phone',
  written: 'Signed form',
  digital: 'Online',
};

export const CONSENT_RELATION_LABEL: Record<ConsentRelation, string> = {
  self: 'The person themselves',
  father: 'Father',
  mother: 'Mother',
  guardian: 'Guardian',
  sibling: 'Brother or sister',
  other: 'Other relative',
};

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
  in_person: 'Verification officer',
  admin: 'Administrator',
};

/** Where a profile stands in the journey from sign-up to a fixed match. */
export type OnboardingStage = 'profile_incomplete' | 'matchmaking_active' | 'match_fixed';

export const ONBOARDING_LABEL: Record<OnboardingStage, string> = {
  profile_incomplete: 'Profile incomplete',
  matchmaking_active: 'Matchmaking',
  match_fixed: 'Match fixed',
};

/** Both sides confirm before a match is fixed; this is how far along that is. */
export type MatchFixedState = 'none' | 'pending_confirmation' | 'confirmed';

export type VerificationStatus =
  | 'new'
  | 'assigned'
  | 'in_progress'
  | 'approved'
  | 'rejected'
  | 'issue'
  | 'additional_review';

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  new: 'Waiting for allocation',
  assigned: 'Allocated to an officer',
  in_progress: 'Visit in progress',
  approved: 'Approved',
  rejected: 'Rejected',
  issue: 'Issue raised',
  additional_review: 'Needs another look',
};

export type CaseStatus =
  | 'open'
  | 'allocated'
  | 'in_progress'
  | 'resolved'
  | 'rejected'
  | 'escalated'
  | 'closed';

export type ProfileLifecycle = 'active' | 'deactivated' | 'archived';

export const LIFECYCLE_LABEL: Record<ProfileLifecycle, string> = {
  active: 'Active',
  deactivated: 'Paused',
  archived: 'Closed',
};

/** Booking states, in the order they actually happen. */
export const BOOKING_STATUS_LABEL: Record<string, string> = {
  requested: 'Request sent',
  quotation_sent: 'Quotation received',
  quotation_accepted: 'Quotation accepted',
  payment_pending: 'Payment pending',
  pending: 'Paid, awaiting confirmation',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  completed: 'Completed',
  disputed: 'Under investigation',
  cancelled: 'Cancelled',
};

export const MILESTONE_LABEL: Record<string, string> = {
  advance: 'Advance',
  second: 'Second instalment',
  final: 'Balance',
};

/**
 * What a published window actually is, as the server reports it.
 *
 * Not the same as the vendor's own status. `booked` means the window has
 * confirmed bookings and can still take more; `full` means it cannot. Keeping
 * those apart is the whole point — a caterer with two of five teams booked is
 * booked *and* open, and collapsing that into one flag is what took their
 * afternoon off sale.
 */
export type SlotState = 'open' | 'booked' | 'full' | 'blocked' | 'cancelled';

export const SLOT_STATE_LABEL: Record<SlotState, string> = {
  open: 'Open',
  booked: 'Booked',
  full: 'Full',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
};

/** How a calendar day reads at a glance. */
export const DAY_STATE_LABEL: Record<string, string> = {
  available: 'Open',
  partially_booked: 'Part booked',
  fully_booked: 'Fully booked',
  blocked: 'Blocked',
  no_availability: 'Nothing published',
};

export type MaritalStatus =
  | 'never_married'
  | 'divorced'
  | 'widowed'
  | 'separated'
  | 'annulled';

export const MARITAL_LABEL: Record<MaritalStatus, string> = {
  never_married: 'Never married',
  divorced: 'Divorced',
  widowed: 'Widowed',
  separated: 'Separated',
  annulled: 'Annulled',
};

export type FamilyType = 'joint' | 'nuclear' | 'extended' | 'single_parent';

export const FAMILY_TYPE_LABEL: Record<FamilyType, string> = {
  joint: 'Joint',
  nuclear: 'Nuclear',
  extended: 'Extended',
  single_parent: 'Single parent',
};

export type OccupationStatus =
  | 'employed'
  | 'self_employed'
  | 'not_employed'
  | 'student'
  | 'homemaker'
  | 'retired';

export const OCCUPATION_LABEL: Record<OccupationStatus, string> = {
  employed: 'Employed',
  self_employed: 'Self-employed / business',
  not_employed: 'Not currently employed',
  student: 'Student',
  homemaker: 'Homemaker',
  retired: 'Retired',
};

export const ASSET_TYPE_LABEL: Record<string, string> = {
  independent_house: 'Independent house',
  apartment: 'Apartment',
  villa: 'Villa',
  agricultural_land: 'Agricultural land',
  residential_plot: 'Residential plot',
  commercial_plot: 'Commercial plot',
  commercial_building: 'Commercial building',
  other: 'Other',
};

/**
 * The same rules the server applies, so a typo is caught in the field rather
 * than after a round trip. The server still enforces them — this is a courtesy
 * to the person typing, never the authority.
 */
export const CASE_STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  allocated: 'Assigned to an officer',
  in_progress: 'Under investigation',
  waiting_for_information: 'Waiting on you',
  escalated: 'Escalated for a visit',
  resolved: 'Settled',
  rejected: 'Not upheld',
  closed: 'Closed',
};

export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const MOBILE_10_PATTERN = /^[6-9]\d{9}$/;
export const NAME_PATTERN = /^[\p{L}][\p{L}\s]*$/u;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const VENDOR_CATEGORIES = [
  'venue',
  'catering',
  'photography',
  'decor',
  'makeup',
  'entertainment',
  'other',
] as const;

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
