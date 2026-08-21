import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 8: the biodata a matrimonial profile actually needs.
 *
 * Until now a profile was a display name, a gender, a date of birth, a city and
 * a preferences blob — enough to demonstrate matchmaking, nowhere near enough
 * to circulate to a family. This adds the sections the intake form asks for:
 * personal, religion, horoscope, marital history, family and assets, education
 * and occupation, and partner preferences.
 *
 * Two shapes, chosen deliberately. `profile_details` is one row per profile,
 * with real columns for anything the platform filters or matches on and grouped
 * JSON for anything read as a block. Siblings and assets get their own tables,
 * because they are added and removed one at a time and an array would make
 * every edit rewrite the whole set.
 *
 * The sensitive half lives here rather than on `profiles` on purpose: income,
 * horoscope and family assets are a visibility question, and keeping them in a
 * separate table makes that a question about a table rather than a column list.
 */
export class Phase8ProfileBiodataAndAgency1710000007000 implements MigrationInterface {
  name = 'Phase8ProfileBiodataAndAgency1710000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- enums --------------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "marital_status_enum"
         AS ENUM ('never_married','divorced','widowed','separated','annulled');`,
    );
    await queryRunner.query(
      `CREATE TYPE "family_type_enum" AS ENUM ('joint','nuclear','extended','single_parent');`,
    );
    await queryRunner.query(
      `CREATE TYPE "occupation_status_enum"
         AS ENUM ('employed','self_employed','not_employed','student','homemaker','retired');`,
    );
    await queryRunner.query(
      `CREATE TYPE "family_asset_type_enum"
         AS ENUM ('independent_house','apartment','villa','agricultural_land','residential_plot',
                  'commercial_plot','commercial_building','other');`,
    );
    await queryRunner.query(
      `CREATE TYPE "otp_verification_status_enum" AS ENUM ('sent','verified','failed','expired');`,
    );

    // ---- the biodata --------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "profile_details" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "profileId" uuid NOT NULL,

        "firstName" varchar(80),
        "surname" varchar(80),
        "lastName" varchar(80),
        "heightCm" integer,
        "complexion" varchar(40),
        "nativePlace" varchar(120),
        "placeOfBirth" varchar(120),
        "communicationAddress" text,
        "alternateMobile" varchar,
        "residence" jsonb NOT NULL DEFAULT '{}',

        "religion" varchar(60),
        "caste" varchar(60),
        "subCaste" varchar(60),
        "motherTongue" varchar(60),
        "denomination" varchar(60),

        "horoscopeAvailable" boolean NOT NULL DEFAULT false,
        "horoscope" jsonb NOT NULL DEFAULT '{}',
        "horoscopeDocumentUrl" varchar,

        "maritalStatus" "marital_status_enum",
        "maritalHistory" jsonb NOT NULL DEFAULT '{}',

        "father" jsonb NOT NULL DEFAULT '{}',
        "mother" jsonb NOT NULL DEFAULT '{}',
        "familyType" "family_type_enum",
        "familyStatus" varchar(60),
        "brothers" integer,
        "sisters" integer,

        "highestQualification" varchar(120),
        "course" varchar(160),
        "institution" varchar(160),
        "collegePlace" varchar(120),
        "occupationStatus" "occupation_status_enum",
        "employment" jsonb NOT NULL DEFAULT '{}',
        "business" jsonb NOT NULL DEFAULT '{}',
        "incomeVisible" boolean NOT NULL DEFAULT false,

        "preferredAgeMin" integer,
        "preferredAgeMax" integer,
        "preferredHeightMinCm" integer,
        "preferredHeightMaxCm" integer,
        "partnerPreferences" jsonb NOT NULL DEFAULT '{}',

        "primaryPhotoUrl" varchar,

        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_profile_details_profile" UNIQUE ("profileId"),
        CONSTRAINT "FK_profile_details_profile"
          FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_profile_details_age_range"
          CHECK ("preferredAgeMin" IS NULL OR "preferredAgeMax" IS NULL
                 OR "preferredAgeMin" <= "preferredAgeMax"),
        CONSTRAINT "CK_profile_details_height_range"
          CHECK ("preferredHeightMinCm" IS NULL OR "preferredHeightMaxCm" IS NULL
                 OR "preferredHeightMinCm" <= "preferredHeightMaxCm")
      );`);

    // Indexed because these are the fields families actually filter on.
    for (const column of [
      'religion',
      'caste',
      'subCaste',
      'motherTongue',
      'heightCm',
      'maritalStatus',
      'highestQualification',
      'occupationStatus',
    ]) {
      await queryRunner.query(
        `CREATE INDEX "IDX_profile_details_${column.toLowerCase()}" ON "profile_details" ("${column}");`,
      );
    }

    await queryRunner.query(`
      CREATE TABLE "profile_siblings" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "profileId" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "age" integer,
        "maritalStatus" "marital_status_enum",
        "spouseName" varchar(120),
        "qualification" varchar(120),
        "profession" varchar(120),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_profile_siblings_profile"
          FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE
      );`);
    await queryRunner.query(
      `CREATE INDEX "IDX_profile_siblings_profile" ON "profile_siblings" ("profileId");`,
    );

    await queryRunner.query(`
      CREATE TABLE "profile_assets" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "profileId" uuid NOT NULL,
        "type" "family_asset_type_enum" NOT NULL,
        "location" varchar(160),
        "area" varchar(80),
        "estimatedValue" numeric(14,2),
        "ownership" varchar(120),
        "remarks" text,
        "visible" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_profile_assets_profile"
          FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE
      );`);
    await queryRunner.query(
      `CREATE INDEX "IDX_profile_assets_profile" ON "profile_assets" ("profileId");`,
    );

    // ---- Aadhaar OTP sessions ----------------------------------------------
    //
    // Neither the Aadhaar number nor the code is stored here: the number lives
    // on the profile as a peppered hash, the code as a SHA-256. What this table
    // holds is the shape of the attempt, which is what makes expiry and attempt
    // limits enforceable.
    await queryRunner.query(`
      CREATE TABLE "identity_otp_sessions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "profileId" uuid NOT NULL,
        "requestedByUserId" uuid NOT NULL,
        "providerRef" varchar,
        "codeHash" varchar(64) NOT NULL,
        "aadhaarLast4" varchar(4) NOT NULL,
        "status" "otp_verification_status_enum" NOT NULL DEFAULT 'sent',
        "attempts" integer NOT NULL DEFAULT 0,
        "expiresAt" timestamptz NOT NULL,
        "verifiedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_identity_otp_profile"
          FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE
      );`);
    await queryRunner.query(
      `CREATE INDEX "IDX_identity_otp_profile" ON "identity_otp_sessions" ("profileId");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_identity_otp_status" ON "identity_otp_sessions" ("status");`,
    );

    // ---- the agency record --------------------------------------------------
    await queryRunner.query(`
      ALTER TABLE "agent_profiles"
        ADD COLUMN "address" text,
        ADD COLUMN "startDate" date,
        ADD COLUMN "pictures" jsonb NOT NULL DEFAULT '[]';`);

    // Carry across what the old free-text preferences blob already held, so a
    // profile that had a religion or an age range keeps it rather than starting
    // the new form empty.
    await queryRunner.query(`
      INSERT INTO "profile_details"
        ("profileId","religion","caste","highestQualification","preferredAgeMin","preferredAgeMax")
      SELECT
        p."id",
        NULLIF(p."preferences"->>'religion', ''),
        NULLIF(p."preferences"->>'community', ''),
        NULLIF(p."preferences"->>'education', ''),
        NULLIF(p."preferences"->>'preferredAgeMin', '')::int,
        NULLIF(p."preferences"->>'preferredAgeMax', '')::int
      FROM "profiles" p
      WHERE p."preferences" IS NOT NULL
        AND p."preferences" <> '{}'::jsonb;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agent_profiles"
        DROP COLUMN "address",
        DROP COLUMN "startDate",
        DROP COLUMN "pictures";`);

    await queryRunner.query(`DROP TABLE IF EXISTS "identity_otp_sessions";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "profile_assets";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "profile_siblings";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "profile_details";`);

    await queryRunner.query(`DROP TYPE IF EXISTS "otp_verification_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "family_asset_type_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "occupation_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "family_type_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "marital_status_enum";`);
  }
}
