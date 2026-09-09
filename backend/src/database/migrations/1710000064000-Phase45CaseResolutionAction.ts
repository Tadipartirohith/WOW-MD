import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The category-specific resolution action an officer chose on a support case.
 *
 * A support case used to end with a bare settlement outcome — release, refund,
 * or "no action" — which said what happened to the money but not what the
 * officer actually did about the complaint. A vendor whose listing was frozen
 * and a vendor asking about a payout both resolved to "no action", and neither
 * record could say whether the listing was unlocked or the payout verified
 * (EZ1-I181). This records the named action, so the resolution reads as the
 * thing it was, and so `unlock_listing` can drive a real side-effect. Nullable:
 * older cases and admin-direct settlements carry none.
 */
export class Phase45CaseResolutionAction1710000064000 implements MigrationInterface {
  name = 'Phase45CaseResolutionAction1710000064000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "support_cases" ADD COLUMN IF NOT EXISTS "resolutionAction" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "support_cases" DROP COLUMN IF EXISTS "resolutionAction"`,
    );
  }
}
