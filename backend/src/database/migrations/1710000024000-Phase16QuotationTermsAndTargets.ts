import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Terms on a quotation, the quotation a booking was struck on, and where a
 * notification points.
 *
 * All three are additive and nullable. Existing quotations have no terms
 * because none were ever asked for; existing bookings have no accepted
 * quotation id because nothing recorded it at the time, and back-filling one by
 * guessing which quotation was accepted would invent a fact rather than record
 * one. Existing notifications keep null targets and are rendered by the
 * client's older derivation, which is what they were displayed with.
 */
export class Phase16QuotationTermsAndTargets1710000024000 implements MigrationInterface {
  name = 'Phase16QuotationTermsAndTargets1710000024000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "terms" text;`);
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "acceptedQuotationId" uuid;`,
    );
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD COLUMN IF NOT EXISTS "targetModule" varchar(32),
        ADD COLUMN IF NOT EXISTS "targetAction" varchar(32),
        ADD COLUMN IF NOT EXISTS "targetId" uuid;
    `);
    // Read together far more often than separately: "what is waiting on me in
    // bookings" is one query, and without this it is a scan of the user's feed.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_user_target"
        ON "notifications" ("userId", "targetModule");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notifications_user_target";`);
    await queryRunner.query(`
      ALTER TABLE "notifications"
        DROP COLUMN IF EXISTS "targetModule",
        DROP COLUMN IF EXISTS "targetAction",
        DROP COLUMN IF EXISTS "targetId";
    `);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "acceptedQuotationId";`);
    await queryRunner.query(`ALTER TABLE "quotations" DROP COLUMN IF EXISTS "terms";`);
  }
}
