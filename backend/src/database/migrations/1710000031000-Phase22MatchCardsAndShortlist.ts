import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a match card has to be able to say.
 *
 * Three things were missing and none of them could be derived from what was
 * already stored.
 *
 * **A profile code.** Families quote a profile to each other over the phone and
 * on paper. A uuid cannot be read aloud, so in practice people were identifying
 * a match by name and city and getting the wrong one. A short code is the thing
 * they can say, write on a shortlist, and search by.
 *
 * **Last seen.** "Active now" comes from the socket and is gone the moment the
 * tab closes. "Recently active" is a different question — whether it is worth
 * sending an interest at all — and answering it needs a timestamp that outlives
 * the connection.
 *
 * **A shortlist.** Somewhere to put a profile that is worth a second look but
 * not worth an interest yet. Without it the only way to keep a candidate was to
 * approach them, which makes the decision earlier and more public than the
 * family wants it to be.
 */
export class Phase22MatchCardsAndShortlist1710000031000 implements MigrationInterface {
  name = 'Phase22MatchCardsAndShortlist1710000031000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profiles" ADD COLUMN "profileCode" varchar(12)`);
    await queryRunner.query(`ALTER TABLE "profiles" ADD COLUMN "lastActiveAt" TIMESTAMPTZ`);

    // The sequence, not a count: a code must never be reused, and counting rows
    // reuses one the moment a profile is deleted.
    await queryRunner.query(`CREATE SEQUENCE "profile_code_seq" START WITH 10001`);
    await queryRunner.query(`
      UPDATE "profiles"
         SET "profileCode" = 'WOW' || nextval('profile_code_seq')
       WHERE "profileCode" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "profiles"
        ALTER COLUMN "profileCode" SET DEFAULT 'WOW' || nextval('profile_code_seq')
    `);
    await queryRunner.query(`ALTER TABLE "profiles" ALTER COLUMN "profileCode" SET NOT NULL`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_profiles_profileCode" ON "profiles" ("profileCode")`,
    );

    /*
     * Family net worth, alongside the individual assets rather than instead of
     * them. A family that owns three things does not want to list three things
     * to answer the question that is actually being asked, and a family that
     * would rather not itemise still has something to say.
     *
     * Numeric, not an integer: this is rupees, and the figures involved go past
     * what a 32-bit column holds within one house.
     */
    await queryRunner.query(
      `ALTER TABLE "profile_details" ADD COLUMN "familyNetWorth" numeric(14,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile_details" ADD COLUMN "familyNetWorthVisible" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(`
      CREATE TABLE "profile_shortlists" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "ownerProfileId" uuid NOT NULL,
        "profileId" uuid NOT NULL,
        "note" text,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "FK_shortlist_owner" FOREIGN KEY ("ownerProfileId")
          REFERENCES "profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_shortlist_profile" FOREIGN KEY ("profileId")
          REFERENCES "profiles"("id") ON DELETE CASCADE
      )
    `);
    // One entry per pair. Shortlisting twice is the same intent expressed
    // twice, not two intents.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_shortlist_pair"
        ON "profile_shortlists" ("ownerProfileId", "profileId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_shortlist_owner" ON "profile_shortlists" ("ownerProfileId", "createdAt" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "profile_shortlists"`);
    await queryRunner.query(
      `ALTER TABLE "profile_details" DROP COLUMN IF EXISTS "familyNetWorthVisible"`,
    );
    await queryRunner.query(`ALTER TABLE "profile_details" DROP COLUMN IF EXISTS "familyNetWorth"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_profileCode"`);
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN IF EXISTS "lastActiveAt"`);
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN IF EXISTS "profileCode"`);
    await queryRunner.query(`DROP SEQUENCE IF EXISTS "profile_code_seq"`);
  }
}
