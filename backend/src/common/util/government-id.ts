import { createHmac } from 'crypto';
import { GovernmentIdType } from '../enums';

/**
 * Government identity numbers: validation, and a one-way form safe to store.
 *
 * The platform never keeps the number itself. What it keeps is an HMAC of it
 * under a server-side pepper, plus the last four digits so a person can
 * recognise their own record. That is enough to answer the only two questions
 * the platform actually needs to answer — "is this the same person as that
 * other profile?" and "which document was this?" — while a database leak yields
 * nothing usable, because the pepper does not live in the database.
 */

/**
 * Aadhaar's Verhoeff check digit. A typo'd number fails here rather than
 * becoming a permanent duplicate-blocking ghost in the index.
 */
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function isValidAadhaar(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  // Aadhaar numbers never begin 0 or 1 — that range is reserved.
  if (!/^[2-9][0-9]{11}$/.test(digits)) return false;

  let c = 0;
  const reversed = digits.split('').reverse().map(Number);
  reversed.forEach((digit, i) => {
    c = D[c][P[i % 8][digit]];
  });
  return c === 0;
}

const PATTERNS: Record<GovernmentIdType, RegExp> = {
  [GovernmentIdType.AADHAAR]: /^[2-9][0-9]{11}$/,
  [GovernmentIdType.PASSPORT]: /^[A-Z][0-9]{7}$/,
  [GovernmentIdType.VOTER_ID]: /^[A-Z]{3}[0-9]{7}$/,
  [GovernmentIdType.DRIVING_LICENCE]: /^[A-Z]{2}[0-9]{2}[0-9]{11}$/,
  [GovernmentIdType.PAN]: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
};

/** Strips formatting so "1234 5678 9012" and "123456789012" agree. */
export function normaliseId(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidGovernmentId(type: GovernmentIdType, value: string): boolean {
  const normalised = normaliseId(value);
  if (!PATTERNS[type].test(normalised)) return false;
  if (type === GovernmentIdType.AADHAAR) return isValidAadhaar(normalised);
  return true;
}

/**
 * The stored form. Peppered with a server secret so the hash cannot be
 * brute-forced from the database alone — the search space for a 12-digit number
 * is small enough that a plain SHA-256 would be reversible in minutes.
 */
export function hashGovernmentId(type: GovernmentIdType, value: string, pepper: string): string {
  return createHmac('sha256', pepper).update(`${type}:${normaliseId(value)}`).digest('hex');
}

/** The only part of the number a person ever sees again. */
export function lastFour(value: string): string {
  return normaliseId(value).slice(-4);
}
