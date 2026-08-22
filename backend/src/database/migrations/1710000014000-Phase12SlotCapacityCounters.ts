import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Splits a slot's one counter into two, and moves the meaning of "booked" off
 * the status column.
 *
 * The old model had `booked` plus a status that went to PENDING the moment a
 * *request* arrived — so a caterer's five-team afternoon left the buyer's list
 * entirely because one family had enquired about it. Requests and bookings are
 * now separate counters, and only `confirmed` is measured against capacity.
 *
 * The backfill is the delicate part. Every PENDING slot in the old model held
 * exactly one un-answered request, and every BOOKED one was at capacity, so
 * both convert without guessing:
 *
 *   PENDING → status AVAILABLE, pending = 1   (the request is still open)
 *   BOOKED  → status AVAILABLE, confirmed unchanged, and now reads as `full`
 *             because confirmed already equals capacity
 *
 * BLOCKED and CANCELLED are the vendor's own decisions and are left alone.
 */
export class Phase12SlotCapacityCounters1710000014000 implements MigrationInterface {
  name = 'Phase12SlotCapacityCounters1710000014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vendor_availability_slots" RENAME COLUMN "booked" TO "confirmed"`,
    );
    await queryRunner.query(`
      ALTER TABLE "vendor_availability_slots"
      ADD COLUMN IF NOT EXISTS "pending" integer NOT NULL DEFAULT 0
    `);

    // A window that was PENDING had one request against it that nobody had
    // answered. Record that as a pending request and put the window back on
    // sale — which is the entire point of the change.
    await queryRunner.query(`
      UPDATE "vendor_availability_slots"
      SET "pending" = 1, "status" = 'available'
      WHERE "status" = 'pending'
    `);

    // A window that was BOOKED already has confirmed = capacity, so it reads
    // as full from the counters alone. The status column no longer carries
    // that meaning.
    await queryRunner.query(`
      UPDATE "vendor_availability_slots"
      SET "status" = 'available'
      WHERE "status" = 'booked'
    `);

    // Capacity is bounded above by nothing useful, but a negative counter or
    // one that exceeds capacity is a bug the database can refuse outright.
    await queryRunner.query(`
      ALTER TABLE "vendor_availability_slots"
      ADD CONSTRAINT "CHK_slots_counters_sane" CHECK (
        "confirmed" >= 0 AND "pending" >= 0 AND "confirmed" <= "capacity"
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_slots_confirmed" ON "vendor_availability_slots" ("confirmed")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_slots_confirmed"`);
    await queryRunner.query(
      `ALTER TABLE "vendor_availability_slots" DROP CONSTRAINT IF EXISTS "CHK_slots_counters_sane"`,
    );

    // Reconstruct the old status from the counters before losing them.
    await queryRunner.query(`
      UPDATE "vendor_availability_slots"
      SET "status" = 'booked'
      WHERE "status" = 'available' AND "confirmed" >= "capacity"
    `);
    await queryRunner.query(`
      UPDATE "vendor_availability_slots"
      SET "status" = 'pending'
      WHERE "status" = 'available' AND "pending" > 0 AND "confirmed" < "capacity"
    `);

    await queryRunner.query(`ALTER TABLE "vendor_availability_slots" DROP COLUMN IF EXISTS "pending"`);
    await queryRunner.query(
      `ALTER TABLE "vendor_availability_slots" RENAME COLUMN "confirmed" TO "booked"`,
    );
  }
}
