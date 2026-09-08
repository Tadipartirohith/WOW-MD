import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a wedding plan exist before its date is known (EZ1-I116).
 *
 * When a couple books a planner before starting a plan of their own, the
 * planner engagement now creates the plan so the couple appears as a client
 * straight away. That plan may not have a wedding date yet — the booking need
 * not carry an event date — so the column becomes nullable. Every read already
 * treats the date as optional (the dashboard countdown falls back to the next
 * event, the client list shows "date TBD").
 */
export class Phase41PlanWeddingDateNullable1710000050000 implements MigrationInterface {
  name = 'Phase41PlanWeddingDateNullable1710000050000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wedding_plans" ALTER COLUMN "weddingDate" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wedding_plans" ALTER COLUMN "weddingDate" SET NOT NULL`,
    );
  }
}
