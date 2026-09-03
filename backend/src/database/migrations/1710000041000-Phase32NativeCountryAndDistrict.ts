import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Native country and district, completing the native-place hierarchy.
 *
 * "Native place" was a town and, later, a town plus a state. The other side
 * asking where a family is from is asking a four-level question — country,
 * state, district, then the village or town — and two families from the same
 * district could not be matched on it while three of those levels were a single
 * free-text box. The country anchors the state list and the district anchors
 * the village; the village itself stays in `nativePlace` as the free-text leaf.
 */
export class Phase32NativeCountryAndDistrict1710000041000 implements MigrationInterface {
  name = 'Phase32NativeCountryAndDistrict1710000041000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profile_details" ADD COLUMN IF NOT EXISTS "nativeCountry" varchar(80)`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile_details" ADD COLUMN IF NOT EXISTS "nativeDistrict" varchar(120)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of ['nativeDistrict', 'nativeCountry']) {
      await queryRunner.query(
        `ALTER TABLE "profile_details" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
  }
}
