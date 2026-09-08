import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One sign-up link an agency can hand out to bring on new clients (EZ1-I166).
 *
 * The existing invitation flow starts from a profile the agent has already
 * built and addresses a single person. This is the other direction: a link the
 * agent shares — in a WhatsApp message, on a card — that a new client opens to
 * create their own account, which lands in the agency's book (managedByAgentId)
 * exactly as an accepted invitation does. The client still sets their own
 * password, so the agent never holds their credentials.
 *
 * Hashed, like every other token here: the column is enough to check a link
 * against and not enough to forge one from, so a database dump does not hand
 * somebody every open sign-up link on the platform.
 */
export class AgentClientShareLink1710000060000 implements MigrationInterface {
  name = 'AgentClientShareLink1710000060000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent_profiles"
        ADD COLUMN IF NOT EXISTS "shareTokenHash" varchar(128),
        ADD COLUMN IF NOT EXISTS "shareTokenCreatedAt" TIMESTAMP WITH TIME ZONE
    `);

    // The lookup is by hash on every open of the link, so it wants an index —
    // and a unique one, because two agencies sharing a token would bind a new
    // client to whichever row came back first.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_agent_profiles_share_token"
        ON "agent_profiles" ("shareTokenHash")
        WHERE "shareTokenHash" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agent_profiles_share_token"`);
    await queryRunner.query(`
      ALTER TABLE "agent_profiles"
        DROP COLUMN IF EXISTS "shareTokenHash",
        DROP COLUMN IF EXISTS "shareTokenCreatedAt"
    `);
  }
}
