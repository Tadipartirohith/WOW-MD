import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dismissing a profile somebody else shared with you.
 *
 * Shared With Me offered exactly one action — Send interest — so an agent who
 * had looked at a profile and decided against it had no way to say so. The card
 * stayed in the list forever, and the only way to clear it was to approach a
 * family the agent had already ruled out.
 *
 * Deliberately not `revokedAt`, which is the *sharer's* decision to withdraw a
 * share. This is the receiver's decision about their own screen, and the two
 * must not be able to overwrite one another: an agency should never be able to
 * tell that the agent they shared with dismissed their client.
 */
export class Phase23IgnoreSharedProfile1710000032000 implements MigrationInterface {
  name = 'Phase23IgnoreSharedProfile1710000032000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profile_shares" ADD COLUMN "ignoredAt" TIMESTAMPTZ`);
    await queryRunner.query(
      `ALTER TABLE "profile_shares" ADD COLUMN "ignoredByUserId" uuid`,
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_shares_ignoredAt" ON "profile_shares" ("ignoredAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_shares_ignoredAt"`);
    await queryRunner.query(
      `ALTER TABLE "profile_shares" DROP COLUMN IF EXISTS "ignoredByUserId"`,
    );
    await queryRunner.query(`ALTER TABLE "profile_shares" DROP COLUMN IF EXISTS "ignoredAt"`);
  }
}
