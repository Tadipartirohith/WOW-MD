import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A postal address on the profile.
 *
 * Every account type needed somewhere to put one and only the biodata had it,
 * so a vendor or planner filling in their profile typed an address into a form
 * that had nowhere to store it and watched it vanish on reload. The biodata's
 * `communicationAddress` stays where it is — that one is part of what a family
 * circulates; this is the account's own address and is never shared.
 */
export class Phase9ProfileContactDetails1710000008000 implements MigrationInterface {
  name = 'Phase9ProfileContactDetails1710000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "address" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN IF EXISTS "address"`);
  }
}
