import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When a vendor started trading, as a date.
 *
 * Families ask a vendor how long they have been doing this, the same question
 * the agency form already answered with its own start date. The vendor had
 * nowhere to put it, so the "Trading Since" field on the My Business flow had no
 * column behind it (EZ1-I21). A nullable date, because a business that has not
 * said yet is not an error.
 */
export class Phase33VendorTradingSince1710000042000 implements MigrationInterface {
  name = 'Phase33VendorTradingSince1710000042000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "tradingSince" date`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "vendors" DROP COLUMN IF EXISTS "tradingSince"`);
  }
}
