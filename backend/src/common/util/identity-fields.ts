/**
 * Shared rules for the three fields every persona types by hand: their name,
 * their mobile number and (for a business) its registration identifiers.
 *
 * They live here rather than in one module's DTO because the same value is
 * entered in several places — sign-up, the vendor profile, an agency's client
 * intake — and a rule that holds in one of those and not the others is worse
 * than no rule at all.
 */

/**
 * A person's name: letters and spaces, nothing else.
 *
 * Deliberately excludes digits and punctuation, which is what the spec asks
 * for. It does allow accented and Indic letters, because a rule that rejects
 * "Ramesh Naráyan" or a name typed in Telugu is not validating, it is
 * excluding.
 */
export const NAME_PATTERN = /^[\p{L}][\p{L}\s]*$/u;

export const NAME_MESSAGE =
  'Name may contain letters and spaces only — no digits or special characters';

/** Collapses runs of whitespace and trims, so " Rakesh   Rao " becomes "Rakesh Rao". */
export const normaliseName = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value;

/**
 * The same, except that a blank string means "not given" rather than "given, and
 * empty".
 *
 * `@IsOptional()` only skips `undefined`, so a form that submits an empty box
 * for a field nobody filled in gets the pattern applied to '' and fails with a
 * message about special characters — which is both wrong and confusing. Used on
 * fields where absent is genuinely allowed.
 */
export const normaliseOptionalName = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * Indian mobile numbers are ten digits beginning 6–9. People type them with
 * spaces, dashes, a `+91`, a bare `91` or a leading `0`, and every one of those
 * is the same number — so the transform strips the decoration, and what is
 * stored is always the same E.164 string.
 *
 * One stored form matters more here than it looks: the phone number is the
 * duplicate key for an agency-built profile, and "+91 98765 43210" sitting
 * beside "9876543210" means the same person gets taken on twice.
 *
 * E.164 rather than the bare ten digits because the moment SMS is wired up the
 * gateway will want a country code, and back-filling one across a live table is
 * a migration nobody enjoys.
 */
export const MOBILE_PATTERN = /^\+91[6-9]\d{9}$/;

export const MOBILE_MESSAGE = 'Enter a 10-digit Indian mobile number';

/** Strips formatting and any country prefix, leaving the ten national digits. */
export function nationalMobileDigits(input: string): string {
  const digits = input.replace(/[^\d]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(3);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

export function toE164(nationalDigits: string): string {
  return `+91${nationalDigits}`;
}

/**
 * Leaves anything that is not ten valid digits alone rather than "fixing" it,
 * so the pattern below rejects it and the person sees why.
 */
export const normaliseMobile = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const digits = nationalMobileDigits(value);
  return /^[6-9]\d{9}$/.test(digits) ? toE164(digits) : value.trim();
};

/** 15-character GSTIN: state code, PAN, entity digit, Z, checksum. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export const GSTIN_MESSAGE =
  'Enter a valid 15-character GSTIN, for example 29ABCDE1234F1Z5';

/** 10-character PAN: five letters, four digits, a letter. */
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export const PAN_MESSAGE = 'Enter a valid 10-character PAN, for example ABCDE1234F';

export const upperCaseTrim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.replace(/\s/g, '').toUpperCase() : value;
