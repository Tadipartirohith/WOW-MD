import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add-on requests on a confirmed booking (EZ1-I215).
 *
 * A mini-quotation the buyer raises against a booking whose advance is held: an
 * extra service, quantity, an optional predefined price and requirements. The
 * vendor accepts, rejects or requotes; a requote waits on the buyer to accept.
 * One row per request, never edited away, so the agreed extra and its price stay
 * on the record.
 */
export class Phase47BookingAddons1710000072000 implements MigrationInterface {
  name = 'Phase47BookingAddons1710000072000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "booking_addons_status_enum" AS ENUM ('requested', 'accepted', 'rejected', 'requoted');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "booking_addons" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "bookingId" uuid NOT NULL,
        "requestedByUserId" uuid NOT NULL,
        "title" character varying NOT NULL,
        "description" text,
        "quantity" integer NOT NULL DEFAULT 1,
        "proposedPrice" numeric(12,2),
        "vendorPrice" numeric(12,2),
        "currency" character varying NOT NULL DEFAULT 'INR',
        "note" text,
        "status" "booking_addons_status_enum" NOT NULL DEFAULT 'requested',
        "respondedByUserId" uuid,
        "respondedAt" TIMESTAMP WITH TIME ZONE,
        "responseNote" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_booking_addons" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_booking_addons_booking" ON "booking_addons" ("bookingId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_booking_addons_requested_by" ON "booking_addons" ("requestedByUserId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_booking_addons_status" ON "booking_addons" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_booking_addons_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_booking_addons_requested_by"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_booking_addons_booking"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "booking_addons"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "booking_addons_status_enum"`);
  }
}
