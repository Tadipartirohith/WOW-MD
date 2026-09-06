import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Contact and location details on a planner profile.
 *
 * The planner listing carried a name, a city and a bio but none of the contact
 * or address detail a couple needs to evaluate and reach a planner, and there
 * was nothing to validate (EZ1-I69). These columns give the My Business form
 * real fields to hold and check. All nullable — an existing listing is not
 * invalid for predating them.
 */
export class Phase35PlannerBusinessFields1710000044000 implements MigrationInterface {
  name = 'Phase35PlannerBusinessFields1710000044000';

  private readonly columns: [string, string][] = [
    ['contactPerson', 'varchar(120)'],
    ['contactPhone', 'varchar'],
    ['contactEmail', 'varchar(254)'],
    ['address', 'text'],
    ['state', 'varchar(80)'],
    ['pincode', 'varchar(6)'],
    ['website', 'varchar(200)'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, type] of this.columns) {
      await queryRunner.query(
        `ALTER TABLE "planner_profiles" ADD COLUMN IF NOT EXISTS "${name}" ${type}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [name] of this.columns) {
      await queryRunner.query(`ALTER TABLE "planner_profiles" DROP COLUMN IF EXISTS "${name}"`);
    }
  }
}
