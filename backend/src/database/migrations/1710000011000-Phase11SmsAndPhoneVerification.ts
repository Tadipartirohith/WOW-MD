import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SMS as a real channel, and the phone as a verified identity.
 *
 * Intake went phone-first some time ago: an agent can take on a walk-in family
 * who give a mobile number and nothing else. Invitations still went by email
 * only, so that family's profile could be built and then never handed over —
 * the platform had no way to reach them at all. `invitations.email` becomes
 * nullable so an invitation can go out by SMS alone, and the address is
 * collected when they claim the account.
 *
 * Phone verification matters more than email verification in this market, and
 * until now the number was collected, validated, treated as the identity key
 * for duplicate detection — and never once confirmed to be reachable.
 */
export class Phase11SmsAndPhoneVerification1710000011000 implements MigrationInterface {
  name = 'Phase11SmsAndPhoneVerification1710000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "invitations" ALTER COLUMN "email" DROP NOT NULL`);

    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phoneVerifiedAt" timestamptz`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "phone_verifications" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "phone" varchar NOT NULL,
        -- The code is hashed like every other credential on the platform. A
        -- six-digit number sitting in plaintext is readable by anyone with a
        -- database, and it is the whole of the second factor.
        "codeHash" varchar(64) NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "expiresAt" timestamptz NOT NULL,
        "consumedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_phone_verifications_user" ON "phone_verifications" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_phone_verifications_expiry" ON "phone_verifications" ("expiresAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "phone_verifications"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "phoneVerifiedAt"`);
    // Rows written while the column was nullable would break the constraint,
    // so they are given a placeholder rather than blocking the rollback.
    await queryRunner.query(
      `UPDATE "invitations" SET "email" = concat('unknown+', "id", '@invalid') WHERE "email" IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "invitations" ALTER COLUMN "email" SET NOT NULL`);
  }
}
