import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A price change that is waiting on somebody.
 *
 * Held beside the live price rather than replacing it: a vendor who doubles
 * their rate on a live listing should not have their shop taken off sale while
 * an administrator looks, so the old price keeps selling and the new one
 * applies on approval.
 *
 * Both columns are nullable and nothing is back-filled. The feature is off
 * unless `CATALOG_REVIEW_THRESHOLD_PERCENT` is set, so on an existing database
 * every row is correctly "nothing pending".
 */
export class Phase19CatalogPriceReview1710000028000 implements MigrationInterface {
  name = 'Phase19CatalogPriceReview1710000028000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service_offerings"
        ADD COLUMN IF NOT EXISTS "pendingPrice" numeric(12,2),
        ADD COLUMN IF NOT EXISTS "pendingSince" timestamptz;
    `);
    // The admin queue asks one question — what is waiting — so the index
    // covers only the rows that are.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_service_offerings_pending"
        ON "service_offerings" ("pendingSince")
        WHERE "pendingPrice" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_service_offerings_pending";`);
    await queryRunner.query(`
      ALTER TABLE "service_offerings"
        DROP COLUMN IF EXISTS "pendingPrice",
        DROP COLUMN IF EXISTS "pendingSince";
    `);
  }
}
