import { BusinessStatus } from '../../common/enums';

/**
 * What a business may do, in each state it can be in.
 *
 * Written as data rather than scattered through the service, because the whole
 * point of a state machine is that the answer to "can I edit this now?" is in
 * one place. Ten `if (status === …)` checks in ten methods is how a business
 * ends up editable during its own verification.
 */
export interface BusinessRules {
  /** Business identity: name, category, GST, PAN, registration, address. */
  editIdentity: boolean;
  /** Services, packages, prices. Manageable for far longer than identity is. */
  editCatalog: boolean;
  /** Publish availability and take bookings. */
  trade: boolean;
  /** Ask somebody to look at it. */
  submit: boolean;
  /** Appears in search. */
  visible: boolean;
  /** What the vendor is told, in the state they are in. */
  note: string;
}

export const BUSINESS_RULES: Record<BusinessStatus, BusinessRules> = {
  [BusinessStatus.DRAFT]: {
    editIdentity: true,
    editCatalog: true,
    trade: false,
    submit: true,
    visible: false,
    note: 'Being set up. Nobody else can see it yet.',
  },
  [BusinessStatus.READY_FOR_REVIEW]: {
    editIdentity: true,
    editCatalog: true,
    trade: false,
    submit: true,
    visible: false,
    note: 'Everything needed is filled in. Look it over, then submit it.',
  },
  [BusinessStatus.FIRST_REVIEW]: {
    // Still editable: the point of a review step is to find things to change.
    editIdentity: true,
    editCatalog: true,
    trade: false,
    submit: true,
    visible: false,
    note: 'Check it over. You can still go back and edit anything.',
  },
  [BusinessStatus.PENDING_VERIFICATION]: {
    editIdentity: false,
    editCatalog: false,
    trade: false,
    submit: false,
    visible: false,
    note: 'Submitted. An officer will visit — the details are locked until then.',
  },
  [BusinessStatus.VERIFICATION_IN_PROGRESS]: {
    editIdentity: false,
    editCatalog: false,
    trade: false,
    submit: false,
    visible: false,
    note: 'An officer is verifying this now.',
  },
  [BusinessStatus.VERIFIED]: {
    editIdentity: false,
    editCatalog: true,
    trade: true,
    submit: false,
    visible: true,
    note: 'Verified. Your prices and services stay yours to change; the legal details do not.',
  },
  [BusinessStatus.LIVE]: {
    // The verified identity is what was checked, so it stays locked. The
    // catalog is the shop floor and has to keep moving.
    editIdentity: false,
    editCatalog: true,
    trade: true,
    visible: true,
    submit: false,
    note: 'Live and taking bookings.',
  },
  [BusinessStatus.REVERIFICATION_REQUIRED]: {
    // The whole point: edit access comes back so the problem can be fixed.
    editIdentity: true,
    editCatalog: true,
    trade: false,
    submit: true,
    visible: false,
    note: 'Something needs correcting. Fix it and submit again.',
  },
  [BusinessStatus.REJECTED]: {
    editIdentity: false,
    editCatalog: false,
    trade: false,
    submit: false,
    visible: false,
    note: 'Refused. This listing cannot be edited — create a new one instead.',
  },
};

/**
 * Which states may follow which.
 *
 * A table rather than a set of guards, so an illegal move is impossible to
 * write rather than merely unlikely.
 */
const ALLOWED: Record<BusinessStatus, BusinessStatus[]> = {
  [BusinessStatus.DRAFT]: [BusinessStatus.READY_FOR_REVIEW],
  [BusinessStatus.READY_FOR_REVIEW]: [BusinessStatus.DRAFT, BusinessStatus.FIRST_REVIEW],
  [BusinessStatus.FIRST_REVIEW]: [BusinessStatus.DRAFT, BusinessStatus.PENDING_VERIFICATION],
  [BusinessStatus.PENDING_VERIFICATION]: [
    BusinessStatus.VERIFICATION_IN_PROGRESS,
    // Straight to verified as well: an officer who writes up a visit has made
    // one, whether or not they pressed "start" beforehand. The gate that
    // matters is that findings exist, and that is enforced on the request —
    // insisting on a button here would refuse a decision the officer is
    // entitled to make because of how they navigated to it.
    BusinessStatus.VERIFIED,
    BusinessStatus.REVERIFICATION_REQUIRED,
    BusinessStatus.REJECTED,
  ],
  [BusinessStatus.VERIFICATION_IN_PROGRESS]: [
    BusinessStatus.VERIFIED,
    BusinessStatus.REVERIFICATION_REQUIRED,
    BusinessStatus.REJECTED,
  ],
  [BusinessStatus.VERIFIED]: [BusinessStatus.LIVE, BusinessStatus.REVERIFICATION_REQUIRED],
  [BusinessStatus.LIVE]: [BusinessStatus.REVERIFICATION_REQUIRED],
  // Back to the beginning of the editing loop, not straight to verification:
  // the vendor has to look at it again before anybody else does.
  [BusinessStatus.REVERIFICATION_REQUIRED]: [BusinessStatus.DRAFT, BusinessStatus.FIRST_REVIEW],
  // Terminal. A refused listing is archived and a new one created; letting it
  // move would be letting a vendor edit their way around a refusal.
  [BusinessStatus.REJECTED]: [],
};

export function canTransition(from: BusinessStatus, to: BusinessStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export function rulesFor(status: BusinessStatus): BusinessRules {
  return BUSINESS_RULES[status] ?? BUSINESS_RULES[BusinessStatus.DRAFT];
}
