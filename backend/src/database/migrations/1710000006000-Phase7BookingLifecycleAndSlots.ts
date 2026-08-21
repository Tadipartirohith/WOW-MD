import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 7: the booking lifecycle the marketplace actually runs on.
 *
 *  - **Availability becomes time slots.** A day with a capacity cannot express
 *    "12–4 is gone, 6–10 is free", which is exactly how wedding vendors sell.
 *    Each existing day row is carried over as one all-day slot so nothing is
 *    lost, and the old table is dropped.
 *  - **A booking records what was asked for**: the slot, the event, the
 *    requirements and an optional budget — the things a provider needs before
 *    they can quote.
 *  - **Money and work alternate.** `COMPLETED_PENDING_FINAL_PAYMENT` is the
 *    state that makes it possible: the provider says the work is done, and the
 *    booking closes only when the balance is paid.
 *  - **`OTHER` joins the vendor categories**, so a trade nobody listed is kept
 *    on the platform rather than turned away.
 */
export class Phase7BookingLifecycleAndSlots1710000006000 implements MigrationInterface {
  name = 'Phase7BookingLifecycleAndSlots1710000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- vendors: the Other category --------------------------------------
    await queryRunner.query(`ALTER TYPE "vendors_category_enum" ADD VALUE IF NOT EXISTS 'other';`);
    await queryRunner.query(
      `ALTER TABLE "vendors" ADD COLUMN "otherCategory" varchar(80);`,
    );

    // ---- availability: day rows become time slots -------------------------
    await queryRunner.query(
      `CREATE TYPE "vendor_availability_slots_status_enum"
         AS ENUM ('available','pending','booked','blocked','cancelled');`,
    );
    await queryRunner.query(`
      CREATE TABLE "vendor_availability_slots" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "vendorId" uuid NOT NULL,
        "date" date NOT NULL,
        "startTime" time NOT NULL,
        "endTime" time NOT NULL,
        "capacity" integer NOT NULL DEFAULT 1,
        "booked" integer NOT NULL DEFAULT 0,
        "status" "vendor_availability_slots_status_enum" NOT NULL DEFAULT 'available',
        "bookingId" uuid,
        "note" varchar(200),
        "blockReason" varchar(200),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_availability_slots_vendor"
          FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_availability_slots_times" CHECK ("startTime" < "endTime"),
        CONSTRAINT "CK_availability_slots_booked" CHECK ("booked" <= "capacity")
      );`);
    await queryRunner.query(
      `CREATE INDEX "IDX_availability_slots_vendor_date" ON "vendor_availability_slots" ("vendorId","date");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_availability_slots_status" ON "vendor_availability_slots" ("status");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_availability_slots_booking" ON "vendor_availability_slots" ("bookingId");`,
    );

    // Carry the old day rows across as all-day windows. A vendor who had
    // blocked a date (capacity zero) keeps it blocked rather than silently
    // becoming available again.
    await queryRunner.query(`
      INSERT INTO "vendor_availability_slots"
        ("vendorId","date","startTime","endTime","capacity","booked","status","note")
      SELECT
        "vendorId",
        "date",
        '00:00'::time,
        '23:59'::time,
        GREATEST("capacity", 1),
        LEAST("booked", GREATEST("capacity", 1)),
        CASE
          WHEN "capacity" = 0 THEN 'blocked'
          WHEN "booked" >= "capacity" THEN 'booked'
          ELSE 'available'
        END::"vendor_availability_slots_status_enum",
        "note"
      FROM "vendor_availability";`);
    await queryRunner.query(`DROP TABLE "vendor_availability";`);

    // ---- bookings: what was asked for, and where the work has got to -------
    await queryRunner.query(
      `ALTER TYPE "bookings_status_enum"
         ADD VALUE IF NOT EXISTS 'completed_pending_final_payment' AFTER 'in_progress';`,
    );
    await queryRunner.query(`
      ALTER TABLE "bookings"
        ADD COLUMN "slotId" uuid,
        ADD COLUMN "eventId" uuid,
        ADD COLUMN "requirements" text,
        ADD COLUMN "expectedBudget" numeric(12,2),
        ADD COLUMN "startedAt" timestamptz,
        ADD COLUMN "completedAt" timestamptz;`);
    await queryRunner.query(`CREATE INDEX "IDX_bookings_slot" ON "bookings" ("slotId");`);
    await queryRunner.query(`CREATE INDEX "IDX_bookings_event" ON "bookings" ("eventId");`);

    // ---- cases remember where they froze a booking ------------------------
    await queryRunner.query(
      `ALTER TABLE "support_cases" ADD COLUMN "bookingPreviousStatus" varchar;`,
    );

    // A booking already delivered has its completion timestamp back-filled from
    // the row's own last update, which is the closest honest approximation.
    await queryRunner.query(`
      UPDATE "bookings" SET "completedAt" = "updatedAt" WHERE "status" = 'completed';`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "support_cases" DROP COLUMN "bookingPreviousStatus";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bookings_event";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bookings_slot";`);
    await queryRunner.query(`
      ALTER TABLE "bookings"
        DROP COLUMN "slotId",
        DROP COLUMN "eventId",
        DROP COLUMN "requirements",
        DROP COLUMN "expectedBudget",
        DROP COLUMN "startedAt",
        DROP COLUMN "completedAt";`);

    // Anything sitting in the state this migration introduced is moved to the
    // nearest older one before the enum is rebuilt, or the cast fails and the
    // rollback dies half-done.
    await queryRunner.query(`
      UPDATE "bookings" SET "status" = 'in_progress'
       WHERE "status" = 'completed_pending_final_payment';`);
    await queryRunner.query(
      `ALTER TYPE "bookings_status_enum" RENAME TO "bookings_status_enum_new";`,
    );
    await queryRunner.query(
      `CREATE TYPE "bookings_status_enum"
         AS ENUM ('requested','quotation_sent','quotation_accepted','payment_pending','pending',
                  'confirmed','in_progress','completed','disputed','cancelled');`,
    );
    await queryRunner.query(`ALTER TABLE "bookings" ALTER COLUMN "status" DROP DEFAULT;`);
    await queryRunner.query(
      `ALTER TABLE "bookings" ALTER COLUMN "status" TYPE "bookings_status_enum" USING "status"::text::"bookings_status_enum";`,
    );
    await queryRunner.query(`ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'requested';`);
    await queryRunner.query(`DROP TYPE "bookings_status_enum_new";`);

    // Rebuild the day-level table and fold the slots back into it, so a
    // rollback does not lose a vendor's blocked dates.
    await queryRunner.query(`
      CREATE TABLE "vendor_availability" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "vendorId" uuid NOT NULL,
        "date" date NOT NULL,
        "capacity" integer NOT NULL DEFAULT 1,
        "booked" integer NOT NULL DEFAULT 0,
        "note" varchar,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_vendor_availability_vendor_date" UNIQUE ("vendorId","date"),
        CONSTRAINT "FK_vendor_availability_vendor"
          FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_vendor_availability_booked" CHECK ("booked" <= "capacity")
      );`);
    await queryRunner.query(`
      INSERT INTO "vendor_availability" ("vendorId","date","capacity","booked","note")
      SELECT
        "vendorId",
        "date",
        CASE WHEN bool_and("status" = 'blocked') THEN 0 ELSE SUM("capacity")::int END,
        LEAST(
          SUM("booked")::int,
          CASE WHEN bool_and("status" = 'blocked') THEN 0 ELSE SUM("capacity")::int END
        ),
        MIN("note")
      FROM "vendor_availability_slots"
      GROUP BY "vendorId","date";`);
    await queryRunner.query(
      `CREATE INDEX "IDX_vendor_availability_date" ON "vendor_availability" ("date");`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "vendor_availability_slots";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "vendor_availability_slots_status_enum";`);

    await queryRunner.query(`ALTER TABLE "vendors" DROP COLUMN "otherCategory";`);
    // Postgres cannot drop one label from an enum, so the category type is
    // rebuilt without 'other'; listings using it fall back to the closest
    // catch-all rather than blocking the rollback.
    await queryRunner.query(
      `UPDATE "vendors" SET "category" = 'entertainment' WHERE "category" = 'other';`,
    );
    await queryRunner.query(
      `ALTER TYPE "vendors_category_enum" RENAME TO "vendors_category_enum_new";`,
    );
    await queryRunner.query(
      `CREATE TYPE "vendors_category_enum"
         AS ENUM ('venue','catering','photography','decor','makeup','entertainment');`,
    );
    await queryRunner.query(
      `ALTER TABLE "vendors" ALTER COLUMN "category" TYPE "vendors_category_enum" USING "category"::text::"vendors_category_enum";`,
    );
    await queryRunner.query(`DROP TYPE "vendors_category_enum_new";`);
  }
}
