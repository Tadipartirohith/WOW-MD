import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two ways out of a dead end.
 *
 * **Recovery codes.** An administrator who loses their authenticator is locked
 * out permanently: admins cannot disable two-factor on themselves by design,
 * and there is no second factor to fall back on. The only route back was a
 * database edit, which is not a recovery process — it is an outage with a DBA
 * attached. Codes are hashed like passwords, single-use, and issued at setup.
 *
 * **Profile claims.** If an agent builds a profile for somebody who then signs
 * up on their own, the invitation is refused as a duplicate and the agent's
 * work is stranded — there was no way to connect the two. A claim request lets
 * the agent ask, and the person who owns the account decide.
 */
export class Phase11RecoveryCodesAndClaims1710000012000 implements MigrationInterface {
  name = 'Phase11RecoveryCodesAndClaims1710000012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "mfa_recovery_codes" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        -- bcrypt, not a plain hash: these are as good as a password, and a fast
        -- hash over a short alphabet is brute-forceable offline.
        "codeHash" varchar(120) NOT NULL,
        "usedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_mfa_recovery_user" ON "mfa_recovery_codes" ("userId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "profile_claim_requests" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "profileId" uuid NOT NULL,
        "requestedByUserId" uuid NOT NULL,
        "targetUserId" uuid NOT NULL,
        "status" varchar NOT NULL DEFAULT 'pending',
        "message" text,
        "respondedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_claim_requests_target" ON "profile_claim_requests" ("targetUserId", "status")`,
    );
    // One live request per profile: an agent who taps twice should not produce
    // two decisions for the same person to make.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_claim_requests_pending"
         ON "profile_claim_requests" ("profileId") WHERE "status" = 'pending'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "profile_claim_requests"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "mfa_recovery_codes"`);
  }
}
