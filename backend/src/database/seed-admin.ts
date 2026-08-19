import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { config as loadEnv } from 'dotenv';
import dataSource from './data-source';
import { UserRole } from '../common/enums';

loadEnv();

/**
 * Bootstraps the first administrator.
 *
 * ADMIN is deliberately absent from the self-registration allow-list, so it
 * cannot be created through the API at all. This script is the supported way in:
 * run it once per environment with ADMIN_EMAIL / ADMIN_PASSWORD set.
 *
 *   npm run seed:admin          (source, needs ts-node)
 *   npm run seed:admin:prod     (compiled, inside the container)
 *
 * Idempotent: re-running promotes and re-activates the existing account rather
 * than failing on the unique email index.
 */
async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD before running the admin seed.');
    process.exitCode = 1;
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`ADMIN_EMAIL is not a valid email address: ${email}`);
    process.exitCode = 1;
    return;
  }
  if (password.length < 12) {
    console.error('ADMIN_PASSWORD must be at least 12 characters.');
    process.exitCode = 1;
    return;
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
