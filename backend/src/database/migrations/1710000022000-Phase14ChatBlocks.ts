import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Blocking and reporting.
 *
 * Two tables rather than one flag, because they answer different questions. A
 * block is "stop this", between two people, one-directional, and the other side
 * is never told. A report is "somebody should look at this" — a claim the
 * platform has to act on, which outlives the reporter changing their mind.
 *
 * The unique pair on `chat_blocks` is what makes blocking idempotent: tapping
 * it twice is one block, not two.
 */
export class Phase14ChatBlocks1710000022000 implements MigrationInterface {
  name = 'Phase14ChatBlocks1710000022000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chat_blocks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "blockerUserId" uuid NOT NULL,
        "blockedUserId" uuid NOT NULL,
        "note" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_blocks" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_chat_blocks_pair" UNIQUE ("blockerUserId", "blockedUserId"),
        CONSTRAINT "FK_chat_blocks_blocker"
          FOREIGN KEY ("blockerUserId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_chat_blocks_blocked"
          FOREIGN KEY ("blockedUserId") REFERENCES "users"("id") ON DELETE CASCADE,
        -- Blocking yourself is always a mistake, and it would silently break
        -- your own conversations.
        CONSTRAINT "CHK_chat_blocks_not_self" CHECK ("blockerUserId" <> "blockedUserId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chat_blocks_blocker" ON "chat_blocks" ("blockerUserId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chat_blocks_blocked" ON "chat_blocks" ("blockedUserId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chat_reports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "reporterUserId" uuid NOT NULL,
        "reportedUserId" uuid NOT NULL,
        "reason" character varying(60) NOT NULL,
        "detail" text,
        "evidence" jsonb NOT NULL DEFAULT '[]',
        "reviewed" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_reports" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_reports_reporter"
          FOREIGN KEY ("reporterUserId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_chat_reports_reported"
          FOREIGN KEY ("reportedUserId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_chat_reports_not_self" CHECK ("reporterUserId" <> "reportedUserId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chat_reports_reported" ON "chat_reports" ("reportedUserId")`,
    );
    // The queue an administrator works from: everything not yet looked at.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_chat_reports_pending"
      ON "chat_reports" ("reviewed", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_reports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_blocks"`);
  }
}
