import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A per-agency profile-creation fee (EZ1-I128).
 *
 * The fee was a single platform-wide value, but agencies agree different fees
 * with their clients. This column overrides the default per agency; null keeps
 * the platform default.
 */
export class Phase39AgencyProfileFee1710000048000 implements MigrationInterface {
  name = 'Phase39AgencyProfileFee1710000048000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_profiles" ADD COLUMN IF NOT EXISTS "profileCreationFee" numeric(12,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_profiles" DROP COLUMN IF EXISTS "profileCreationFee"`,
    );
  }
}
