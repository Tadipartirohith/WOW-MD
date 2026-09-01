import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reviews get a lifecycle, a booking, and somebody accountable for them.
 *
 * A review used to be a rating and a comment with nothing around it: no way to
 * hold one back, no way to take one down, no record of who did either, and no
 * link to the transaction it was supposedly about. So a review was published
 * the instant it was written and stayed published whatever it said.
 *
 * The unique index moves with that. It was one review per (vendor, user),
 * enforced by upsert — which quietly meant a second review overwrote the first
 * and the rating count never moved. Now it is one per booking, which is the
 * thing being reviewed: two completed jobs with the same vendor are two
 * experiences and deserve two reviews, and one job cannot be reviewed twice.
 */
export class Phase26ReviewModeration1710000035000 implements MigrationInterface {
  name = 'Phase26ReviewModeration1710000035000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "review_status_enum" AS ENUM (
          'published', 'under_review', 'flagged', 'removed'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "vendor_reviews"
        ADD COLUMN IF NOT EXISTS "status" "review_status_enum" NOT NULL DEFAULT 'published',
        ADD COLUMN IF NOT EXISTS "bookingId" uuid,
        ADD COLUMN IF NOT EXISTS "moderationReason" text,
        ADD COLUMN IF NOT EXISTS "moderatedByUserId" uuid,
        ADD COLUMN IF NOT EXISTS "moderatedAt" TIMESTAMPTZ
    `);

    // Everything already written was published, and stays published: holding
    // back reviews retroactively would take down ratings vendors have been
    // trading on, over rules that did not exist when they were written.
    await queryRunner.query(
      `UPDATE "vendor_reviews" SET "status" = 'published' WHERE "status" IS NULL`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_vendor_reviews_status" ON "vendor_reviews" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_vendor_reviews_booking" ON "vendor_reviews" ("bookingId")`,
    );

    /*
     * One review per booking, replacing one per (vendor, user).
     *
     * Partial, because the older rows have no booking and would all collide on
     * NULL under a plain unique index — and they are real reviews that must
     * not be deleted to make a constraint fit.
     */
    await queryRunner.query(
      `ALTER TABLE "vendor_reviews" DROP CONSTRAINT IF EXISTS "UQ_vendor_reviews_vendorId_userId"`,
    );
    await queryRunner.query(`
      DO $$
      DECLARE c text;
      BEGIN
        SELECT conname INTO c FROM pg_constraint
         WHERE conrelid = 'vendor_reviews'::regclass AND contype = 'u';
        IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE vendor_reviews DROP CONSTRAINT %I', c); END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_vendor_reviews_booking"
        ON "vendor_reviews" ("bookingId") WHERE "bookingId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_vendor_reviews_booking"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_vendor_reviews_booking"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_vendor_reviews_status"`);
    await queryRunner.query(`
      ALTER TABLE "vendor_reviews"
        DROP COLUMN IF EXISTS "moderatedAt",
        DROP COLUMN IF EXISTS "moderatedByUserId",
        DROP COLUMN IF EXISTS "moderationReason",
        DROP COLUMN IF EXISTS "bookingId",
        DROP COLUMN IF EXISTS "status"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "review_status_enum"`);
  }
}
