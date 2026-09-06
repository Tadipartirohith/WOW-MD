import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Who cancelled a booking, and when.
 *
 * The reason was already stored, but who cancelled lived only in an event
 * payload and the audit trail, never on the booking — so the other side was
 * told a booking was cancelled without who did it or why (EZ1-I77). Two
 * nullable columns, because the vast majority of bookings are never cancelled.
 */
export class Phase34BookingCancelledBy1710000043000 implements MigrationInterface {
  name = 'Phase34BookingCancelledBy1710000043000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "cancelledByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "cancelledAt"`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "cancelledByUserId"`);
  }
}
