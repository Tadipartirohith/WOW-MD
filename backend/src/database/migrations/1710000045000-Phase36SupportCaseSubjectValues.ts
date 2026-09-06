import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The 'availability' and 'account' support-case subject types.
 *
 * The CaseSubject enum gained these two values in code (EZ1-I49) so a vendor
 * could raise a case about a specific concern, and the Support form offers them
 * — but the Postgres enum type was never widened to match, so choosing either
 * failed the insert with a 500. This adds the two values; the status enum
 * already carries its full set.
 */
export class Phase36SupportCaseSubjectValues1710000045000 implements MigrationInterface {
  name = 'Phase36SupportCaseSubjectValues1710000045000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "support_cases_subjecttype_enum" ADD VALUE IF NOT EXISTS 'availability'`,
    );
    await queryRunner.query(
      `ALTER TYPE "support_cases_subjecttype_enum" ADD VALUE IF NOT EXISTS 'account'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot drop a value from an enum type without rebuilding it, and
    // rows may reference these by now, so the down migration is intentionally a
    // no-op rather than a destructive rebuild.
  }
}
