import type { Tone } from '@/components/chrome';

/**
 * What each state of a business means to the person in it.
 *
 * These are copied from the web client rather than read out of it, and that is
 * the exception the sharing rule allows for: on that side they live inside
 * component files — `BUSINESS_STATUS_LABEL` in VendorDashboardParts.tsx,
 * `STATUS_LABEL` in BusinessSetup.tsx — not in the pure `lib/` modules that
 * `src/shared` re-exports. Importing a component file here would drag React
 * Router and Phosphor's web build into this bundle.
 *
 * The wording is what matters and is kept identical: a vendor who reads
 * "Sent back for changes" on their laptop and "reverification required" on
 * their phone is looking at two products.
 */
export const BUSINESS_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  ready_for_review: 'Ready for your review',
  first_review: 'Your review',
  pending_verification: 'Waiting for a verification officer',
  verification_in_progress: 'Officer visiting',
  verified: 'Verified',
  live: 'Live in search',
  reverification_required: 'Sent back for changes',
  rejected: 'Refused',
};

const STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral',
  ready_for_review: 'caution',
  first_review: 'caution',
  pending_verification: 'brand',
  verification_in_progress: 'brand',
  verified: 'positive',
  live: 'positive',
  reverification_required: 'caution',
  rejected: 'critical',
};

export function businessTone(status: string): Tone {
  return STATUS_TONE[status] ?? 'caution';
}

/** The seven vendor categories, as the listing form labels them. */
export const CATEGORY_LABEL: Record<string, string> = {
  venue: 'Venue',
  catering: 'Catering',
  photography: 'Photography',
  decor: 'Decor',
  makeup: 'Makeup',
  entertainment: 'Entertainment',
  other: 'Other',
};

/** A listing's category in words, honouring the free-text "other". */
export function categoryLabel(category: string, otherCategory?: string | null): string {
  if (category === 'other') return otherCategory ?? 'Other';
  return CATEGORY_LABEL[category] ?? category;
}

/** Statuses in which nothing is left to submit, so Review & Submit is dropped. */
export function isVerifiedLive(status?: string): boolean {
  return status === 'verified' || status === 'live';
}
