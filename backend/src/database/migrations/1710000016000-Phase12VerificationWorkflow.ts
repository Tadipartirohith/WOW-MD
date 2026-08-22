import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The two stages between an officer's visit and a decision.
 *
 * The old chain let an officer approve a business straight from ASSIGNED,
 * without recording that they had been anywhere and without anybody reviewing
 * what they found. That is a verification step in name only.
 *
 *   NEW → ASSIGNED → IN_PROGRESS → SUBMITTED → ADMIN_REVIEW → decision
 *
 * The officer reports; an administrator decides. `findings` is where the report
 * lives — structured rather than a single remarks string, because "what did you
 * actually see" and "why are you rejecting this" are different questions and
 * were collapsing into one field.
 */
export class Phase12VerificationWorkflow1710000016000 implements MigrationInterface {
  name = 'Phase12VerificationWorkflow1710000016000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres will not add enum values inside a transaction that then uses
    // them, so each ADD VALUE is its own statement and the backfill follows.
    await queryRunner.query(
      `ALTER TYPE "verification_requests_status_enum" ADD VALUE IF NOT EXISTS 'submitted'`,
    );
    await queryRunner.query(
      `ALTER TYPE "verification_requests_status_enum" ADD VALUE IF NOT EXISTS 'admin_review'`,
    );

    await queryRunner.query(`
      ALTER TABLE "verification_requests"
      ADD COLUMN IF NOT EXISTS "findings" jsonb,
      ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "submittedByUserId" uuid,
      ADD COLUMN IF NOT EXISTS "reviewStartedAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "reviewedByUserId" uuid,
      ADD COLUMN IF NOT EXISTS "revisitCount" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_verification_requests_assigned_status"
      ON "verification_requests" ("assignedToUserId", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_verification_requests_assigned_status"`);

    // Anything mid-flow goes back to the nearest state the old chain had, so a
    // rollback does not leave rows holding an enum value that no longer exists.
    await queryRunner.query(`
      UPDATE "verification_requests"
      SET "status" = 'in_progress'
      WHERE "status" IN ('submitted', 'admin_review')
    `);

    await queryRunner.query(`
      ALTER TABLE "verification_requests"
      DROP COLUMN IF EXISTS "revisitCount",
      DROP COLUMN IF EXISTS "reviewedByUserId",
      DROP COLUMN IF EXISTS "reviewStartedAt",
      DROP COLUMN IF EXISTS "submittedByUserId",
      DROP COLUMN IF EXISTS "submittedAt",
      DROP COLUMN IF EXISTS "findings"
    `);

    // Postgres cannot drop a value from an enum type, so the two added values
    // stay in the type definition. Harmless: nothing references them any more.
  }
}
