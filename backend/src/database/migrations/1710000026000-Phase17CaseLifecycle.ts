import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The support case grows the states the lifecycle actually has.
 *
 * TRIAGED, RESOLUTION_SUBMITTED, ADMIN_REVIEW and REASSIGNED, plus a priority
 * and a category set at triage, and `resolvedAt` as a fact separate from
 * `closedAt`.
 *
 * The two timestamps are the point. A case is resolved when the platform has
 * decided and closed when the person who raised it accepts that — one column
 * for both let support mark its own homework, because everything looked
 * finished the moment staff stopped working on it.
 *
 * Enum values are added in their own statements and nothing here uses them:
 * Postgres refuses a new enum value inside the transaction that added it, so a
 * migration that adds a value and then writes it fails on a fresh database and
 * passes on one where the value already exists.
 */
export class Phase17CaseLifecycle1710000026000 implements MigrationInterface {
  name = 'Phase17CaseLifecycle1710000026000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const value of ['triaged', 'resolution_submitted', 'admin_review', 'reassigned']) {
      await queryRunner.query(
        `ALTER TYPE "support_cases_status_enum" ADD VALUE IF NOT EXISTS '${value}';`,
      );
    }

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "support_cases_priority_enum" AS ENUM ('low', 'normal', 'high', 'urgent');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "support_cases"
        ADD COLUMN IF NOT EXISTS "priority" "support_cases_priority_enum" NOT NULL DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS "category" varchar(64),
        ADD COLUMN IF NOT EXISTS "resolvedAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "resolvedByUserId" uuid;
    `);

    // Cases decided before the two were separable were marked closed the moment
    // they were resolved, so `closedAt` is the only date they have. Copying it
    // across records what is actually known — that the decision happened then —
    // rather than leaving a null that reads as "never resolved".
    await queryRunner.query(`
      UPDATE "support_cases"
         SET "resolvedAt" = "closedAt",
             "resolvedByUserId" = "closedByUserId"
       WHERE "resolvedAt" IS NULL
         AND "closedAt" IS NOT NULL
         AND "settlementOutcome" IS NOT NULL;
    `);

    // The desk queue is read by priority within status far more often than by
    // either alone.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_support_cases_status_priority"
        ON "support_cases" ("status", "priority");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_cases_status_priority";`);
    // Rows sitting in one of the new states have to land somewhere the old enum
    // recognises. IN_PROGRESS is the honest answer for all four: work on them
    // has started and has not been decided.
    await queryRunner.query(`
      UPDATE "support_cases"
         SET "status" = 'in_progress'
       WHERE "status" IN ('triaged', 'resolution_submitted', 'admin_review', 'reassigned');
    `);
    await queryRunner.query(`
      ALTER TABLE "support_cases"
        DROP COLUMN IF EXISTS "priority",
        DROP COLUMN IF EXISTS "category",
        DROP COLUMN IF EXISTS "resolvedAt",
        DROP COLUMN IF EXISTS "resolvedByUserId";
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "support_cases_priority_enum";`);
    // The enum values themselves are left in place: Postgres cannot drop one,
    // and nothing now uses them.
  }
}
