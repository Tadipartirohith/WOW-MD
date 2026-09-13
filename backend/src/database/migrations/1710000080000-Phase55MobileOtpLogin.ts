import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Signing in with a mobile number and a one-time code (EZ1-I258).
 *
 * The codes table already existed, for proving a number is real. A sign-in code
 * is a different thing issued in different circumstances — nobody is signed in
 * when it is asked for — and letting one stand in for the other would mean a
 * code sent to confirm a number could take over the account it was sent to.
 * So a code now records what it is for, and each route accepts only its own.
 *
 * Everything already issued was a verification code, which is what the default
 * says. No row changes meaning.
 */
export class Phase55MobileOtpLogin1710000080000 implements MigrationInterface {
  name = 'Phase55MobileOtpLogin1710000080000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "phone_verifications"
         ADD COLUMN IF NOT EXISTS "purpose" varchar(16) NOT NULL DEFAULT 'verify'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_phone_verifications_purpose"
         ON "phone_verifications" ("purpose")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_phone_verifications_purpose"`);
    await queryRunner.query(`ALTER TABLE "phone_verifications" DROP COLUMN IF EXISTS "purpose"`);
  }
}
