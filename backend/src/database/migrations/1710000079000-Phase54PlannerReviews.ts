import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reviews and ratings for wedding planners (EZ1-I244).
 *
 * A table of its own rather than a `providerType` column on `vendor_reviews`.
 * The two hang off different listings and are recounted onto different rows,
 * and sharing one table would put a planner's reviews a forgotten `where`
 * clause away from a vendor's average — on the number both of them trade on.
 *
 * The shape follows the vendor table as it stands *after* its own corrections:
 * the uniqueness is on the booking rather than on (planner, user), because two
 * completed weddings with the same planner are two experiences and the pair key
 * silently overwrote the first review with the second.
 *
 * `review_status_enum` already exists (Phase 26) and is reused rather than
 * duplicated, so moderation means the same four things for both kinds of
 * provider.
 */
export class Phase54PlannerReviews1710000079000 implements MigrationInterface {
  name = 'Phase54PlannerReviews1710000079000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Created by Phase 26 for vendor reviews. Guarded so this migration also
    // applies to a database built from a dump taken before that ran.
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "review_status_enum" AS ENUM (
          'published', 'under_review', 'flagged', 'removed'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "planner_reviews" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "plannerId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "bookingId" uuid,
        "rating" int NOT NULL,
        "comment" text,
        "categories" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" "review_status_enum" NOT NULL DEFAULT 'published',
        "moderationReason" text,
        "moderatedByUserId" uuid,
        "moderatedAt" TIMESTAMPTZ,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_planner_reviews_planner" ON "planner_reviews" ("plannerId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_planner_reviews_status" ON "planner_reviews" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_planner_reviews_booking" ON "planner_reviews" ("bookingId")`,
    );
    /*
     * One review per booking, enforced here as well as in the service.
     *
     * Partial, because a review written before a booking was recorded against
     * it has no booking id, and any number of those may coexist. The service
     * refuses a second review on a booking anyway; this is what makes two
     * requests arriving at once unable to get past it.
     */
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_planner_reviews_booking"
         ON "planner_reviews" ("bookingId") WHERE "bookingId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The enum stays: vendor_reviews uses it.
    await queryRunner.query(`DROP TABLE IF EXISTS "planner_reviews"`);
  }
}
