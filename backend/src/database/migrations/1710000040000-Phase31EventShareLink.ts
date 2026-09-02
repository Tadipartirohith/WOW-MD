import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One link per event that anybody can answer.
 *
 * Inviting somebody meant first entering them as a guest — name, contact, the
 * lot — and only then sending them a token addressed to that row. That works
 * for a list you already hold and is the wrong shape for a wedding, where the
 * invitation goes into a family WhatsApp group and the host finds out who is
 * coming from the replies.
 *
 * Hashed, like every other token here: the column is enough to check a link
 * against and not enough to forge one from, so a database dump does not hand
 * somebody every open invitation on the platform.
 */
export class Phase31EventShareLink1710000040000 implements MigrationInterface {
  name = 'Phase31EventShareLink1710000040000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "events"
        ADD COLUMN IF NOT EXISTS "shareTokenHash" varchar(128),
        ADD COLUMN IF NOT EXISTS "shareTokenCreatedAt" TIMESTAMP WITH TIME ZONE
    `);

    // The lookup is by hash on every open of the link, so it wants an index —
    // and a unique one, because two events sharing a token would send a guest
    // to whichever row came back first.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_events_share_token"
        ON "events" ("shareTokenHash")
        WHERE "shareTokenHash" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_events_share_token"`);
    await queryRunner.query(`
      ALTER TABLE "events"
        DROP COLUMN IF EXISTS "shareTokenHash",
        DROP COLUMN IF EXISTS "shareTokenCreatedAt"
    `);
  }
}
