import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5: how an agency actually works.
 *
 * A family walks into the agency and hands over their details; the agent then
 * circulates the biodata looking for a match. Two consequences:
 *
 *  - **Intake is phone-first.** Email stops being mandatory on an agency-built
 *    profile: a walk-in gives a number far more often than an address, and many
 *    clients never want a login at all.
 *  - **Circulation becomes a first-class thing**, with consent in front of it.
 *    profile_consents records who agreed to what and when; profile_shares
 *    records every act of passing a profile on, revocably; the network pool and
 *    cross-agent proposal notes cover the rest.
 */
export class Phase5ConsentAndCirculation1710000004000 implements MigrationInterface {
  name = 'Phase5ConsentAndCirculation1710000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- profiles: phone-first intake, plus pool visibility ----------------
    await queryRunner.query(
      `CREATE TYPE "profiles_networkvisibility_enum" AS ENUM ('private','pool');`,
    );
    await queryRunner.query(
      `ALTER TABLE "profiles"
         ADD COLUMN "networkVisibility" "profiles_networkvisibility_enum" NOT NULL DEFAULT 'private';`,
    );
    await queryRunner.query(`ALTER TABLE "profiles" ADD COLUMN "pooledAt" timestamptz;`);
    await queryRunner.query(
      `CREATE INDEX "IDX_profiles_network_visibility" ON "profiles" ("networkVisibility");`,
    );
    // Phone is now the practical identity key for a walk-in client, so it needs
    // an index for the duplicate check that runs on every intake.
    await queryRunner.query(
      `CREATE INDEX "IDX_profiles_contact_phone" ON "profiles" ("contactPhone");`,
    );

    // ---- consent -----------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "profile_consents_scope_enum" AS ENUM ('intake','circulation');`,
    );
    await queryRunner.query(
      `CREATE TYPE "profile_consents_method_enum" AS ENUM ('in_person','phone','written','digital');`,
    );
    await queryRunner.query(
      `CREATE TYPE "profile_consents_relation_enum"
         AS ENUM ('self','father','mother','guardian','sibling','other');`,
    );
    await queryRunner.query(`
      CREATE TABLE "profile_consents" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "profileId" uuid NOT NULL,
        "scope" "profile_consents_scope_enum" NOT NULL,
        "method" "profile_consents_method_enum" NOT NULL,
        "givenByRelation" "profile_consents_relation_enum" NOT NULL,
        "givenByName" varchar NOT NULL,
        "givenByPhone" varchar,
        "givenAt" date NOT NULL,
        "capturedByUserId" uuid NOT NULL,
        "notes" text,
        "expiresAt" timestamptz,
        "revokedAt" timestamptz,
        "revokedReason" varchar,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_profile_consents_profile"
          FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_profile_consents_captured_by"
          FOREIGN KEY ("capturedByUserId") REFERENCES "users"("id") ON DELETE CASCADE
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_consents_profile" ON "profile_consents" ("profileId");`);
    await queryRunner.query(
      `CREATE INDEX "IDX_consents_profile_scope" ON "profile_consents" ("profileId", "scope");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_consents_captured_by" ON "profile_consents" ("capturedByUserId");`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_consents_expires" ON "profile_consents" ("expiresAt");`);
    await queryRunner.query(`CREATE INDEX "IDX_consents_revoked" ON "profile_consents" ("revokedAt");`);

    // Existing agency-built profiles predate consent capture. Back-fill an
    // intake record attributed to their steward so they stay usable, rather
    // than silently becoming unusable on deploy. Circulation is NOT back-filled:
    // nobody agreed to that, so those profiles start un-circulatable.
    await queryRunner.query(`
      INSERT INTO "profile_consents"
        ("profileId","scope","method","givenByRelation","givenByName","givenAt","capturedByUserId","notes")
      SELECT p.id, 'intake', 'in_person', 'self', p."displayName", CURRENT_DATE, p."managedByUserId",
             'Back-filled on migration: consent predates consent capture.'
        FROM "profiles" p
       WHERE p."managedByUserId" IS NOT NULL;`);

    // ---- shares ------------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "profile_shares_audience_enum" AS ENUM ('agent','user','link');`,
    );
    await queryRunner.query(`
      CREATE TABLE "profile_shares" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "profileId" uuid NOT NULL,
        "sharedByUserId" uuid NOT NULL,
        "audience" "profile_shares_audience_enum" NOT NULL,
        "recipientUserId" uuid,
        "tokenHash" varchar,
        "message" text,
        "expiresAt" timestamptz,
        "viewCount" integer NOT NULL DEFAULT 0,
        "lastViewedAt" timestamptz,
        "revokedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_profile_shares_profile"
          FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_profile_shares_shared_by"
          FOREIGN KEY ("sharedByUserId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_profile_shares_recipient"
          FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE CASCADE
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_shares_profile" ON "profile_shares" ("profileId");`);
    await queryRunner.query(
      `CREATE INDEX "IDX_shares_profile_audience" ON "profile_shares" ("profileId", "audience");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_shares_shared_by" ON "profile_shares" ("sharedByUserId");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_shares_recipient" ON "profile_shares" ("recipientUserId");`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_shares_revoked" ON "profile_shares" ("revokedAt");`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_shares_token" ON "profile_shares" ("tokenHash")
         WHERE "tokenHash" IS NOT NULL;`,
    );

    // ---- cross-agent proposal notes ---------------------------------------
    await queryRunner.query(`
      CREATE TABLE "proposal_notes" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "interestId" uuid NOT NULL,
        "authorUserId" uuid NOT NULL,
        "authorProfileId" uuid NOT NULL,
        "body" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_proposal_notes_interest"
          FOREIGN KEY ("interestId") REFERENCES "interests"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_proposal_notes_author"
          FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_proposal_notes_author_profile"
          FOREIGN KEY ("authorProfileId") REFERENCES "profiles"("id") ON DELETE CASCADE
      );`);
    await queryRunner.query(
      `CREATE INDEX "IDX_proposal_notes_interest" ON "proposal_notes" ("interestId");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_proposal_notes_author" ON "proposal_notes" ("authorUserId");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "proposal_notes";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "profile_shares";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "profile_shares_audience_enum";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "profile_consents";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "profile_consents_relation_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "profile_consents_method_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "profile_consents_scope_enum";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_contact_phone";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_network_visibility";`);
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN IF EXISTS "pooledAt";`);
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN IF EXISTS "networkVisibility";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "profiles_networkvisibility_enum";`);
  }
}
