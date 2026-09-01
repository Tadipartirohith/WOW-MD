import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Availability stops being a vendor-only idea.
 *
 * A wedding planner takes bookings against dates exactly as a vendor does, and
 * a planner already appears on the buyer side as a provider — bookings have
 * carried `providerType` since they were written. Availability was the one
 * part of that story keyed to `vendorId` alone, so a planner had no way to say
 * which weeks they could take work in, and the buyer's calendar had nothing to
 * read.
 *
 * The column is renamed rather than added alongside. Keeping `vendorId` and
 * storing a planner's id in it would be a lie that outlives everyone who knows
 * about it; a name that means "the provider this belongs to" should say so.
 */
export class Phase27ProviderAvailability1710000036000 implements MigrationInterface {
  name = 'Phase27ProviderAvailability1710000036000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "provider_type_enum" AS ENUM ('vendor', 'planner');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // Everything already stored belongs to a vendor, which is the only thing
    // that could have written it.
    await queryRunner.query(`
      ALTER TABLE "vendor_availability_slots"
        ADD COLUMN IF NOT EXISTS "providerType" "provider_type_enum" NOT NULL DEFAULT 'vendor'
    `);

    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name = 'vendor_availability_slots' AND column_name = 'vendorId'
        ) THEN
          ALTER TABLE "vendor_availability_slots" RENAME COLUMN "vendorId" TO "providerId";
        END IF;
      END $$;
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_vendor_availability_slots_vendorId"`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_slots_provider"
        ON "vendor_availability_slots" ("providerType", "providerId", "date")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_slots_provider"`);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name = 'vendor_availability_slots' AND column_name = 'providerId'
        ) THEN
          ALTER TABLE "vendor_availability_slots" RENAME COLUMN "providerId" TO "vendorId";
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE "vendor_availability_slots" DROP COLUMN IF EXISTS "providerType"`,
    );
  }
}
