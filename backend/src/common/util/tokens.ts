import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Opaque single-use tokens (invitations, email verification, password reset,
 * guest RSVP links).
 *
 * The plaintext is returned once, to be emailed, and only its SHA-256 is
 * persisted. SHA-256 rather than bcrypt is deliberate: these are 256 bits of
 * CSPRNG output, not user-chosen secrets, so there is nothing to brute-force
 * and a lookup by hash stays a single indexed query.
 */
export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison for any secret compared outside the database. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function expiresIn(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}
