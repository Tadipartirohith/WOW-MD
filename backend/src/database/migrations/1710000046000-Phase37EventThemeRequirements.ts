import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Theme/preferences and special requirements on a wedding event (EZ1-I84).
 *
 * These are part of what the couple defines on their own function and what a
 * hired planner then executes against — one shared event record, so the columns
 * live on the event itself rather than being duplicated per portal.
 */
export class Phase37EventThemeRequirements1710000046000 implements MigrationInterface {
  name = 'Phase37EventThemeRequirements1710000046000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "theme" character varying(240)`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "specialRequirements" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "events" DROP COLUMN IF EXISTS "specialRequirements"`);
    await queryRunner.query(`ALTER TABLE "events" DROP COLUMN IF EXISTS "theme"`);
  }
}
