import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A business has a life, not a boolean.
 *
 * `isApproved` answered one question — may this appear in search — and the
 * platform needed several others. Is it still being written? Has the vendor
 * asked anybody to look at it? Is it locked because verification is under way,
 * or locked because it was approved, or locked because it was refused? Those
 * are different states with different rules, and a flag collapses them into
 * "true" and "not true yet".
 *
 * The chain:
 *
 *   DRAFT → READY_FOR_REVIEW → FIRST_REVIEW → PENDING_VERIFICATION
 *         → VERIFICATION_IN_PROGRESS → VERIFIED → LIVE
 *                                    → REVERIFICATION_REQUIRED → (back to edit)
 *                                    → REJECTED → LOCKED
 *
 * Re-verification and rejection are deliberately different branches. One says
 * "fix this and come back"; the other says "no". Treating them the same is what
 * leaves a vendor either stuck with no route forward or able to edit their way
 * around a refusal.
 *
 * `isApproved` is kept and maintained alongside. Search reads it, the earlier
 * suites assert on it, and a rename in the same change as a behaviour change is
 * how you lose track of which one broke something.
 */
export class Phase15BusinessLifecycle1710000023000 implements MigrationInterface {
  name = 'Phase15BusinessLifecycle1710000023000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "business_status_enum" AS ENUM (
        'draft',
        'ready_for_review',
        'first_review',
        'pending_verification',
        'verification_in_progress',
        'verified',
        'live',
        'reverification_required',
        'rejected'
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "vendors"
      ADD COLUMN IF NOT EXISTS "status" "business_status_enum" NOT NULL DEFAULT 'draft',
      ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "decisionReason" text,
      ADD COLUMN IF NOT EXISTS "revisionCount" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP WITH TIME ZONE
    `);

    // Existing businesses keep working. An approved one is live; anything else
    // is a draft, which is what it was in every way that mattered.
    await queryRunner.query(`
      UPDATE "vendors"
      SET "status" = 'live', "verifiedAt" = COALESCE("verifiedAt", "createdAt")
      WHERE "isApproved" = true
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_vendors_owner_status" ON "vendors" ("ownerUserId", "status")
    `);

    // The 72-hour clock. Stored on the verification request rather than the
    // business, because the SLA is about how long the *platform* takes once it
    // has been asked — a vendor sitting on a draft for a month is not a breach.
    await queryRunner.query(`
      ALTER TABLE "verification_requests"
      ADD COLUMN IF NOT EXISTS "slaDeadline" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "slaBreachedAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "verificationStartedAt" TIMESTAMP WITH TIME ZONE
    `);

    // The sweep that finds breaches runs on exactly this.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_verification_requests_sla"
      ON "verification_requests" ("slaDeadline")
      WHERE "slaBreachedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_verification_requests_sla"`);
    await queryRunner.query(`
      ALTER TABLE "verification_requests"
      DROP COLUMN IF EXISTS "verificationStartedAt",
      DROP COLUMN IF EXISTS "slaBreachedAt",
      DROP COLUMN IF EXISTS "slaDeadline"
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_vendors_owner_status"`);
    await queryRunner.query(`
      ALTER TABLE "vendors"
      DROP COLUMN IF EXISTS "archivedAt",
      DROP COLUMN IF EXISTS "revisionCount",
      DROP COLUMN IF EXISTS "decisionReason",
      DROP COLUMN IF EXISTS "verifiedAt",
      DROP COLUMN IF EXISTS "submittedAt",
      DROP COLUMN IF EXISTS "status"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "business_status_enum"`);
  }
}
