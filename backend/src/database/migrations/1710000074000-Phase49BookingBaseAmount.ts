import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The quotation before add-ons (EZ1-I215).
 *
 * Accepting an add-on now rolls its agreed price into the booking total, and
 * re-summing needs a stable figure to add to. Nullable because it is written
 * only when the first add-on is accepted; a booking that never has one keeps
 * `amount` as its single source of truth.
 */
export class Phase49BookingBaseAmount1710000074000 implements MigrationInterface {
  name = 'Phase49BookingBaseAmount1710000074000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "baseAmount" numeric(12,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "baseAmount"`);
  }
}
