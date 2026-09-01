import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records how a payment was made.
 *
 * Card, UPI and netbanking are all the same journey to this platform — the
 * gateway chooses between them at checkout and reports back which was used —
 * but a UPI failure rate and a card failure rate are different problems with
 * different fixes, and neither is visible while every row just says "paid".
 *
 * `cash` is in the type and is not the same kind of thing. The platform does
 * not receive that money, so it cannot hold, release or refund it. Existing
 * rows default to `card`: everything taken before this column existed went
 * through the gateway, and the one value that must never be back-filled onto an
 * old row is `cash`, which would claim the platform never held money it did.
 */
export class Phase28PaymentMethod1710000037000 implements MigrationInterface {
  name = 'Phase28PaymentMethod1710000037000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "payments_method_enum" AS ENUM ('card', 'upi', 'netbanking', 'cash');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "payments"
        ADD COLUMN IF NOT EXISTS "method" "payments_method_enum" NOT NULL DEFAULT 'card'
    `);

    // Reporting reads this by method over a date range, which is a scan
    // without it once the table is a season of bookings deep.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payments_method" ON "payments" ("method")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_method"`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN IF EXISTS "method"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payments_method_enum"`);
  }
}
