import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The engaged planner's execution notes on a wedding event (EZ1-I84).
 *
 * The couple defines the event and its requirements; the hired planner
 * coordinates execution, and their working notes live on the same shared event
 * record rather than in a separate place that could drift from it.
 */
export class Phase38EventPlannerNotes1710000047000 implements MigrationInterface {
  name = 'Phase38EventPlannerNotes1710000047000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "plannerNotes" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "events" DROP COLUMN IF EXISTS "plannerNotes"`);
  }
}
