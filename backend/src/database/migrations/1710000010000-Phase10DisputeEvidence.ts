import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A dispute needs to say which instalment it is about, and show its evidence.
 *
 * "The photographer never turned up" and "the album is three months late" are
 * arguments about different instalments, and an officer deciding whether to
 * release or refund has to know which money is in question. The evidence column
 * holds the URLs of what was uploaded to support the claim — an investigation
 * run on two sentences of prose is a coin toss.
 *
 * `requiresPhysicalVerification` marks the cases that cannot be settled from a
 * desk, so they can be routed to somebody who will actually go and look.
 */
export class Phase10DisputeEvidence1710000010000 implements MigrationInterface {
  name = 'Phase10DisputeEvidence1710000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "support_cases_status_enum" ADD VALUE IF NOT EXISTS 'waiting_for_information'`,
    );
    await queryRunner.query(
      `ALTER TABLE "support_cases" ADD COLUMN IF NOT EXISTS "milestone" varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE "support_cases" ADD COLUMN IF NOT EXISTS "evidence" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "support_cases" ADD COLUMN IF NOT EXISTS "requiresPhysicalVerification" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_support_cases_physical"
         ON "support_cases" ("requiresPhysicalVerification")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres cannot drop a value from an enum, so the added status stays.
    // Nothing writes it once the column it qualifies is gone.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_cases_physical"`);
    await queryRunner.query(
      `ALTER TABLE "support_cases" DROP COLUMN IF EXISTS "requiresPhysicalVerification"`,
    );
    await queryRunner.query(`ALTER TABLE "support_cases" DROP COLUMN IF EXISTS "evidence"`);
    await queryRunner.query(`ALTER TABLE "support_cases" DROP COLUMN IF EXISTS "milestone"`);
  }
}
