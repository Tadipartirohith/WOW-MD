import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Native state, and whether the family is abroad.
 *
 * "Native place" alone is a town, and a town is ambiguous across India — there
 * are Rampurs in six states. The other side asking where a family is from is
 * asking for both halves, and they were only ever getting one.
 *
 * NRI is asked as a yes/no with the city and country hanging off the yes,
 * rather than as a country field that is blank for most people. A blank
 * country is unanswerable: it cannot be told apart from "lives in India" or
 * "did not fill this in", and those are different answers to a question
 * families care about.
 *
 * Living status for each parent needs no column: `father` and `mother` are
 * already jsonb and their DTO already carries `lifeStatus`. Only the form was
 * missing.
 */
export class Phase25FamilyStateAndNri1710000034000 implements MigrationInterface {
  name = 'Phase25FamilyStateAndNri1710000034000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profile_details" ADD COLUMN IF NOT EXISTS "nativeState" varchar(80)`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile_details" ADD COLUMN IF NOT EXISTS "isNri" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile_details" ADD COLUMN IF NOT EXISTS "nriCity" varchar(120)`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile_details" ADD COLUMN IF NOT EXISTS "nriCountry" varchar(80)`,
    );
    // Families search on this one: "settled abroad" is a filter, not a note.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_profile_details_isNri" ON "profile_details" ("isNri")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profile_details_isNri"`);
    for (const column of ['nriCountry', 'nriCity', 'isNri', 'nativeState']) {
      await queryRunner.query(
        `ALTER TABLE "profile_details" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
  }
}
