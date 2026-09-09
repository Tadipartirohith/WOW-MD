import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A managed client's rating of the agent who represents them (EZ1-I206).
 *
 * One standing review per (agent, client) pair, editable in place — the unique
 * index is what makes a second submission a correction rather than a duplicate.
 * The aggregate (average + count) is computed on read, so there is no column to
 * add to agent_profiles here.
 */
export class AgentReviews1710000066000 implements MigrationInterface {
  name = 'AgentReviews1710000066000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agent_reviews" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "rating" integer NOT NULL,
        "comment" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_reviews" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_agent_reviews_agent" ON "agent_reviews" ("agentId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_agent_reviews_user" ON "agent_reviews" ("userId")
    `);

    // One review per (agent, client): the second submission updates the first.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_agent_review_agent_user"
        ON "agent_reviews" ("agentId", "userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_agent_review_agent_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agent_reviews_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agent_reviews_agent"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_reviews"`);
  }
}
