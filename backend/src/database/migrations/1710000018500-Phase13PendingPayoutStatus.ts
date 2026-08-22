import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The payment state that says "owed, not paid".
 *
 * On its own, deliberately. Postgres refuses to *use* a newly added enum value
 * inside the transaction that added it, so a migration that adds the value and
 * then indexes or updates against it fails on a fresh database while appearing
 * to work on one where the value already exists — the worst kind of migration.
 *
 * The columns and the index that go with it are in the migration after this.
 */
export class Phase13PendingPayoutStatus1710000018500 implements MigrationInterface {
  name = 'Phase13PendingPayoutStatus1710000018500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "payments_status_enum" ADD VALUE IF NOT EXISTS 'pending_payout'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot remove a value from an enum type. The rollback in the
    // following migration moves any row still holding it back to escrow, which
    // is where the money in fact is.
  }
}
