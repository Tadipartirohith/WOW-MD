import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admin-controlled, field-targeted correction of a vendor business (EZ1-I205).
 *
 * When an officer finds a problem, an administrator can send the listing back
 * for a fix to specific fields rather than a free reopen. `correctionFields`
 * records which fields the vendor may change; `correctionSnapshot` keeps what
 * they held at that moment, so the officer re-reviewing sees previous against
 * updated. Both nullable — a listing with no correction outstanding has neither,
 * and a plain reverification clears them.
 */
export class Phase46VendorCorrection1710000065000 implements MigrationInterface {
  name = 'Phase46VendorCorrection1710000065000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "correctionFields" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "correctionSnapshot" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "vendors" DROP COLUMN IF EXISTS "correctionSnapshot"`);
    await queryRunner.query(`ALTER TABLE "vendors" DROP COLUMN IF EXISTS "correctionFields"`);
  }
}
