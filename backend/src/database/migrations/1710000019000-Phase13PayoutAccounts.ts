import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where a provider's money actually goes.
 *
 * Escrow computed and recorded the commission split correctly from the start,
 * but `release` only logged: there was nowhere to send the money to. A Route
 * transfer needs the seller's linked account, so that is what this adds — plus
 * the two columns that record what the gateway did about it.
 *
 * `PENDING_PAYOUT` is the state that makes this honest. A provider can take
 * bookings and finish the work before their KYC clears, and when that happens
 * the money is no longer the buyer's but has not reached the seller either.
 * Marking it RELEASED would say the platform had paid somebody it had not.
 */
export class Phase13PayoutAccounts1710000019000 implements MigrationInterface {
  name = 'Phase13PayoutAccounts1710000019000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "payoutAccountId" character varying(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "planner_profiles" ADD COLUMN IF NOT EXISTS "payoutAccountId" character varying(64)
    `);

    await queryRunner.query(`
      ALTER TABLE "payments"
      ADD COLUMN IF NOT EXISTS "payoutRef" character varying(120),
      ADD COLUMN IF NOT EXISTS "payoutNote" text
    `);
    await queryRunner.query(`
      ALTER TABLE "agent_charges"
      ADD COLUMN IF NOT EXISTS "payoutRef" character varying(120),
      ADD COLUMN IF NOT EXISTS "payoutNote" text
    `);

    // Finding what the platform still owes is the query an operator runs most.
    // A plain index on status rather than a partial one filtered to
    // 'pending_payout': Postgres refuses to use a newly added enum value in the
    // transaction that added it, and splitting the two apart to save a few
    // pages is not worth a migration that can only run in a specific order.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payments_status" ON "payments" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_status"`);
    await queryRunner.query(`
      ALTER TABLE "agent_charges"
      DROP COLUMN IF EXISTS "payoutNote",
      DROP COLUMN IF EXISTS "payoutRef"
    `);
    await queryRunner.query(`
      ALTER TABLE "payments"
      DROP COLUMN IF EXISTS "payoutNote",
      DROP COLUMN IF EXISTS "payoutRef"
    `);
    await queryRunner.query(`ALTER TABLE "planner_profiles" DROP COLUMN IF EXISTS "payoutAccountId"`);
    await queryRunner.query(`ALTER TABLE "vendors" DROP COLUMN IF EXISTS "payoutAccountId"`);

    // Anything left owed goes back to being held, which is where it in fact is.
    await queryRunner.query(
      `UPDATE "payments" SET "status" = 'held_in_escrow' WHERE "status" = 'pending_payout'`,
    );
    // Postgres cannot drop a value from an enum type; 'pending_payout' stays in
    // the definition with nothing referencing it.
  }
}
