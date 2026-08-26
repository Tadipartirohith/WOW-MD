import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How a steward is related to the person whose profile they run.
 *
 * "Father", "elder brother", "maternal uncle". The platform knew a profile had
 * a steward and never knew who they were to the person — which is the first
 * thing the other side asks, because a profile run by the father reads very
 * differently from one run by a cousin.
 *
 * Nullable and not back-filled: an agency has no answer to it, and inventing
 * one for existing rows would be inventing a fact about somebody's family.
 */
export class Phase21StewardRelation1710000030000 implements MigrationInterface {
  name = 'Phase21StewardRelation1710000030000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "stewardRelation" varchar(60);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN IF EXISTS "stewardRelation";`);
  }
}
