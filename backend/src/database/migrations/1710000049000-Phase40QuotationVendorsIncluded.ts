import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Whether a planner's quotation includes arranging vendors (EZ1-I143).
 *
 * A planner quotes differently depending on whether the couple wants vendors
 * arranged through them (vendor cost + coordination) or only the planner's own
 * services. This records which offer the quotation is. Null for a vendor's own
 * quotation.
 */
export class Phase40QuotationVendorsIncluded1710000049000 implements MigrationInterface {
  name = 'Phase40QuotationVendorsIncluded1710000049000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "quotations" ADD COLUMN IF NOT EXISTS "vendorsIncluded" boolean`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "quotations" DROP COLUMN IF EXISTS "vendorsIncluded"`);
  }
}
