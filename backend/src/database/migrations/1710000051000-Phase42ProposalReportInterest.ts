import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Which proposal a report came from (EZ1-I130).
 *
 * Reports can now be raised from an agent-to-agent proposal conversation, not
 * only a direct chat. This nullable column records the pairing a proposal
 * report concerns; null keeps the existing meaning — a report about a direct
 * chat, identified by the reporter/reported pair alone.
 */
export class Phase42ProposalReportInterest1710000051000 implements MigrationInterface {
  name = 'Phase42ProposalReportInterest1710000051000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_reports" ADD COLUMN IF NOT EXISTS "interestId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chat_reports_interest" ON "chat_reports" ("interestId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chat_reports_interest"`);
    await queryRunner.query(`ALTER TABLE "chat_reports" DROP COLUMN IF EXISTS "interestId"`);
  }
}
