import { randomBytes } from 'crypto';

/**
 * A temporary password for an account the platform creates on somebody's
 * behalf — a provisioned customer, or a verification officer.
 *
 * Two constraints shape it. It is read off a phone screen or a printed sheet,
 * so the alphabet excludes every look-alike pair (0/O, 1/l/I). And it must
 * satisfy the password policy on the first try, so the required character
 * classes are appended rather than left to chance.
 *
 * It is always paired with `mustResetPassword`, which is what makes it safe to
 * send over email at all: it can do nothing except replace itself.
 */
export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const body = Array.from(randomBytes(12), (b) => alphabet[b % alphabet.length]).join('');
  return `Wow${body}7`;
}
