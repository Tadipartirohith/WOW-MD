/**
 * Matching a place name typed by one person against a place name typed by
 * another.
 *
 * This is the whole reason geography-aware allocation was deferred rather than
 * guessed at: "Hyderabad", "hyderabad ", "Hyderabad, Telangana" and
 * "HYDERABAD-500034" are one city, and a naive equality check reads three of
 * them as no coverage at all — which sends the visit to the wrong officer
 * while looking like it worked.
 *
 * The rules here are deliberately small and predictable. They do not attempt
 * geocoding, fuzzy distance, or a gazetteer: an approximate match that is
 * *sometimes* wrong is worse than an exact one that is honestly narrow,
 * because the narrow one falls back to workload and says so.
 */

/**
 * One canonical form for a place name.
 *
 * Lowercased, accents stripped, punctuation reduced to spaces, inner runs of
 * whitespace collapsed. Everything after the first comma is dropped, so
 * "Hyderabad, Telangana" and "Hyderabad" agree — the state is matched
 * separately when it is needed.
 */
export function normalisePlace(value: string | null | undefined): string {
  if (!value) return '';
  return String(value)
    .split(',')[0]
    .normalize('NFD')
    // Combining marks, so "Bengalūru" and "Bengaluru" agree.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** The state part of "Hyderabad, Telangana", when one was given. */
export function stateOf(value: string | null | undefined): string {
  if (!value) return '';
  const parts = String(value).split(',');
  if (parts.length < 2) return '';
  return normalisePlace(parts[parts.length - 1]);
}

/**
 * Cities that are one place under two names.
 *
 * Kept explicit and short rather than pulled from a dataset. Every entry is a
 * rename people still disagree about in daily use, which is exactly the case
 * where an administrator types one and a vendor types the other. Anything not
 * on this list is treated as a different city — the honest answer.
 */
const ALIASES: Record<string, string> = {
  bombay: 'mumbai',
  calcutta: 'kolkata',
  madras: 'chennai',
  bangalore: 'bengaluru',
  mysore: 'mysuru',
  poona: 'pune',
  baroda: 'vadodara',
  trivandrum: 'thiruvananthapuram',
  cochin: 'kochi',
  gurgaon: 'gurugram',
  pondicherry: 'puducherry',
  vizag: 'visakhapatnam',
  waltair: 'visakhapatnam',
  simla: 'shimla',
  cawnpore: 'kanpur',
  benares: 'varanasi',
  banaras: 'varanasi',
  allahabad: 'prayagraj',
  secunderabad: 'hyderabad',
};

/** The canonical name for a city, following a rename where there is one. */
export function canonicalCity(value: string | null | undefined): string {
  const base = normalisePlace(value);
  return ALIASES[base] ?? base;
}

/** Whether two place names refer to the same city. */
export function sameCity(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = canonicalCity(a);
  const right = canonicalCity(b);
  return left !== '' && left === right;
}
