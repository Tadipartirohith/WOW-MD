import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { config as loadEnv } from 'dotenv';
import dataSource from './data-source';
import { UserRole } from '../common/enums';

loadEnv();

/**
 * The account a fresh checkout can sign in with.
 *
 * There is no other way in: ADMIN is deliberately absent from the
 * self-registration allow-list, so it cannot be minted through the API, and
 * before this default existed a new environment had no administrator at all
 * until somebody thought to set two environment variables.
 *
 * It is weak on purpose — eight characters, no uppercase, and published in
 * this repository, so it is only ever as private as the database is. Anything
 * reachable by more than the person who checked the code out wants
 * ADMIN_EMAIL / ADMIN_PASSWORD set instead.
 *
 * The guard here is a warning rather than a refusal on NODE_ENV, because
 * NODE_ENV is not a usable signal in this project: the local Docker backend
 * runs with NODE_ENV=production, so refusing on it would block the default in
 * the one place it exists to serve and permit it nowhere useful.
 */
const DEFAULT_ADMIN = { email: 'admin@wow.com', password: 'admin123' } as const;

/**
 * Bootstraps the first administrator.
 *
 *   npm run seed:admin          (source, needs ts-node)
 *   npm run seed:admin:prod     (compiled, inside the container)
 *
 * ADMIN_EMAIL / ADMIN_PASSWORD override the default. Idempotent: re-running
 * promotes and re-activates the existing account rather than failing on the
 * unique email index.
 */
async function main(): Promise<void> {
  /*
   * Empty counts as unset, and `??` is not enough to say so.
   *
   * docker-compose passes `ADMIN_EMAIL: ${ADMIN_EMAIL:-}`, so inside the
   * container the variable is always *defined* and usually empty. Falling back
   * with `??` would keep that empty string and make the default below
   * unreachable in the one environment it exists for.
   */
  const set = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);
  const givenEmail = set(process.env.ADMIN_EMAIL);
  const givenPassword = set(process.env.ADMIN_PASSWORD);
  const supplied = Boolean(givenEmail && givenPassword);

  const email = (givenEmail ?? DEFAULT_ADMIN.email).toLowerCase();
  const password = givenPassword ?? DEFAULT_ADMIN.password;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`ADMIN_EMAIL is not a valid email address: ${email}`);
    process.exitCode = 1;
    return;
  }
  // Applied to a password somebody chose, not to the default: the default is
  // already known to be weak, and rejecting it here would only mean the
  // fallback never works.
  if (supplied && password.length < 12) {
    console.error('ADMIN_PASSWORD must be at least 12 characters.');
    process.exitCode = 1;
    return;
  }
  if (!supplied) {
    console.warn(
      `No ADMIN_EMAIL/ADMIN_PASSWORD set — seeding the development default ${email}. ` +
        'Change it before this database is reachable by anyone else.',
    );
  }

  await dataSource.initialize();
  try {
    const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
    const passwordHash = await bcrypt.hash(password, rounds);

    const existing = await dataSource.query('SELECT id FROM users WHERE email = $1', [email]);

    if (existing.length > 0) {
      await dataSource.query(
        `UPDATE users
            SET "passwordHash" = $1, role = $2, "isActive" = true, "isVerified" = true
          WHERE email = $3`,
        [passwordHash, UserRole.ADMIN, email],
      );
      console.log(`Updated existing account ${email} to an active administrator.`);
      return;
    }

    await dataSource.query(
      `INSERT INTO users (email, "passwordHash", role, "isVerified", "isActive")
       VALUES ($1, $2, $3, true, true)`,
      [email, passwordHash, UserRole.ADMIN],
    );
    console.log(`Created administrator ${email}.`);
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((err) => {
  console.error('Admin seed failed:', err);
  process.exitCode = 1;
});
