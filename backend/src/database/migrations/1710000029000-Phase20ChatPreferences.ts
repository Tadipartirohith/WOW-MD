import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-reader settings for a conversation: muted, cleared, removed from the list.
 *
 * A table rather than columns on `conversations`, because every one of these is
 * one side's decision about their own screen. Muting is not an instruction to
 * the other person, and clearing is not a request to destroy their copy —
 * putting either on the shared row would make it both.
 *
 * `clearedAt` is a watermark, so nothing is deleted. The messages are what a
 * dispute is argued from and what a report is investigated with, and "clear
 * this chat" means an empty screen rather than a destroyed record.
 */
export class Phase20ChatPreferences1710000029000 implements MigrationInterface {
  name = 'Phase20ChatPreferences1710000029000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chat_preferences" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "conversationId" uuid NOT NULL,
        "muted" boolean NOT NULL DEFAULT false,
        "clearedAt" timestamptz,
        "deletedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_preferences" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_chat_preferences_user_convo" UNIQUE ("userId", "conversationId")
      );
    `);
    // The conversation list reads every one of this user's rows at once, which
    // is the only access pattern there is.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_chat_preferences_user" ON "chat_preferences" ("userId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chat_preferences_user";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_preferences";`);
  }
}
