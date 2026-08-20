import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 6: the operational spine.
 *
 * Four things arrive together because they are the same story end to end:
 *
 *  - **In-Person verification.** Registration stops granting access. An agent
 *    or vendor is queued, allocated to an officer, visited, and only then
 *    activated — so `in_person` joins the role enum and two work-queue tables
 *    appear.
 *  - **Match Fixed.** A match ends with two confirmations, one from each side,
 *    and the second one provisions accounts for anyone who never had one. That
 *    is what `matchFixedState` and the new user columns are for.
 *  - **Money that follows outcomes.** Booking escrow is staged across three
 *    milestones, agency fees are held until the match is fixed, and an open
 *    case freezes both.
 *  - **Identity.** A hashed government ID with a unique index, which is what
 *    finally stops one person running two profiles.
 *
 * Backwards compatible throughout: every added column is nullable or carries a
 * default that matches the behaviour before this migration.
 */
export class Phase6VerificationAndSettlement1710000005000 implements MigrationInterface {
  name = 'Phase6VerificationAndSettlement1710000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- roles: the verification officer -----------------------------------
    await queryRunner.query(`ALTER TYPE "users_role_enum" RENAME TO "users_role_enum_old";`);
    await queryRunner.query(
      `CREATE TYPE "users_role_enum"
         AS ENUM ('bride','groom','family','agent','vendor','planner','in_person','admin');`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "users_role_enum" USING "role"::text::"users_role_enum";`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'bride';`);
    await queryRunner.query(`DROP TYPE "users_role_enum_old";`);

    // ---- users: provisioned accounts and onboarding stage -------------------
    await queryRunner.query(
      `CREATE TYPE "users_onboardingstage_enum"
         AS ENUM ('profile_incomplete','matchmaking_active','match_fixed');`,
    );
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "mustResetPassword" boolean NOT NULL DEFAULT false,
        ADD COLUMN "isProvisioned" boolean NOT NULL DEFAULT false,
        ADD COLUMN "onboardingStage" "users_onboardingstage_enum"
          NOT NULL DEFAULT 'profile_incomplete',
        ADD COLUMN "matchInterestId" uuid,
        ADD COLUMN "tokenVersion" integer NOT NULL DEFAULT 0;`);
    await queryRunner.query(
      `CREATE INDEX "IDX_users_onboarding_stage" ON "users" ("onboardingStage");`,
    );
    // Everyone who already has a profile is past the first stage. Getting this
    // wrong would show the whole existing user base a "finish your profile"
    // gate they have already been through.
    await queryRunner.query(`
      UPDATE "users" u
         SET "onboardingStage" = 'matchmaking_active'
       WHERE EXISTS (SELECT 1 FROM "profiles" p WHERE p."userId" = u."id");`);

    // ---- verification queue -------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "verification_requests_applicanttype_enum" AS ENUM ('agent','vendor','planner','customer');`,
    );
    await queryRunner.query(
      `CREATE TYPE "verification_requests_status_enum"
         AS ENUM ('new','assigned','in_progress','approved','rejected','issue','additional_review');`,
    );
    await queryRunner.query(`
      CREATE TABLE "verification_requests" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "applicantType" "verification_requests_applicanttype_enum" NOT NULL,
        "applicantUserId" uuid NOT NULL,
        "subjectId" uuid,
        "status" "verification_requests_status_enum" NOT NULL DEFAULT 'new',
        "assignedToUserId" uuid,
        "allocatedByUserId" uuid,
        "allocatedAt" timestamptz,
        "decidedAt" timestamptz,
        "decidedByUserId" uuid,
        "remarks" text,
        "history" jsonb NOT NULL DEFAULT '[]',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_verification_requests_applicant"
          FOREIGN KEY ("applicantUserId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_verification_requests_officer"
          FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL
      );`);
    await queryRunner.query(
      `CREATE INDEX "IDX_verification_requests_status" ON "verification_requests" ("status");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_verification_requests_applicant" ON "verification_requests" ("applicantUserId");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_verification_requests_assigned" ON "verification_requests" ("assignedToUserId");`,
    );

    // ---- support cases ------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "support_cases_subjecttype_enum"
         AS ENUM ('agent','vendor','profile','match','booking','payment','other');`,
    );
    await queryRunner.query(
      `CREATE TYPE "support_cases_status_enum"
         AS ENUM ('open','allocated','in_progress','resolved','rejected','escalated','closed');`,
    );
    await queryRunner.query(
      `CREATE TYPE "support_cases_settlementoutcome_enum"
         AS ENUM ('release','refund','partial','no_action');`,
    );
    await queryRunner.query(`
      CREATE TABLE "support_cases" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "subjectType" "support_cases_subjecttype_enum" NOT NULL,
        "subjectId" uuid,
        "raisedByUserId" uuid NOT NULL,
        "title" varchar NOT NULL,
        "description" text NOT NULL,
        "status" "support_cases_status_enum" NOT NULL DEFAULT 'open',
        "assignedToUserId" uuid,
        "allocatedAt" timestamptz,
        "findings" text,
        "settlementOutcome" "support_cases_settlementoutcome_enum",
        "settlementAmount" numeric(12,2),
        "settlementNotes" text,
        "closedAt" timestamptz,
        "closedByUserId" uuid,
        "history" jsonb NOT NULL DEFAULT '[]',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_support_cases_raised_by"
          FOREIGN KEY ("raisedByUserId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_support_cases_officer"
          FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_support_cases_status" ON "support_cases" ("status");`);
    await queryRunner.query(
      `CREATE INDEX "IDX_support_cases_subject" ON "support_cases" ("subjectType","subjectId");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_support_cases_assigned" ON "support_cases" ("assignedToUserId");`,
    );

    // ---- interests: the two-sided Match Fixed -------------------------------
    await queryRunner.query(`ALTER TYPE "interests_status_enum" RENAME TO "interests_status_enum_old";`);
    await queryRunner.query(
      `CREATE TYPE "interests_status_enum"
         AS ENUM ('pending','accepted','rejected','withdrawn','unmatched','blocked');`,
    );
    await queryRunner.query(`ALTER TABLE "interests" ALTER COLUMN "status" DROP DEFAULT;`);
    await queryRunner.query(
      `ALTER TABLE "interests" ALTER COLUMN "status" TYPE "interests_status_enum" USING "status"::text::"interests_status_enum";`,
    );
    await queryRunner.query(`ALTER TABLE "interests" ALTER COLUMN "status" SET DEFAULT 'pending';`);
    await queryRunner.query(`DROP TYPE "interests_status_enum_old";`);

    await queryRunner.query(
      `CREATE TYPE "interests_matchfixedstate_enum"
         AS ENUM ('none','pending_confirmation','confirmed');`,
    );
    await queryRunner.query(`
      ALTER TABLE "interests"
        ADD COLUMN "matchFixedState" "interests_matchfixedstate_enum" NOT NULL DEFAULT 'none',
        ADD COLUMN "fixedConfirmedFromAt" timestamptz,
        ADD COLUMN "fixedConfirmedToAt" timestamptz,
        ADD COLUMN "matchFixedAt" timestamptz,
        ADD COLUMN "endedByUserId" uuid,
        ADD COLUMN "endedReason" text;`);
    await queryRunner.query(
      `CREATE INDEX "IDX_interests_match_fixed_state" ON "interests" ("matchFixedState");`,
    );

    // ---- profiles: lifecycle and identity ----------------------------------
    await queryRunner.query(
      `CREATE TYPE "profiles_lifecycle_enum" AS ENUM ('active','deactivated','archived');`,
    );
    await queryRunner.query(
      `CREATE TYPE "profiles_governmentidtype_enum"
         AS ENUM ('aadhaar','passport','voter_id','driving_licence','pan');`,
    );
    await queryRunner.query(`
      ALTER TABLE "profiles"
        ADD COLUMN "lifecycle" "profiles_lifecycle_enum" NOT NULL DEFAULT 'active',
        ADD COLUMN "deactivatedAt" timestamptz,
        ADD COLUMN "archivedAt" timestamptz,
        ADD COLUMN "lifecycleReason" text,
        ADD COLUMN "governmentIdType" "profiles_governmentidtype_enum",
        ADD COLUMN "governmentIdHash" varchar(64),
        ADD COLUMN "governmentIdLast4" varchar(4),
        ADD COLUMN "idSubmittedAt" timestamptz,
        ADD COLUMN "idVerifiedAt" timestamptz,
        ADD COLUMN "idVerifiedByUserId" uuid;`);
    await queryRunner.query(
      `CREATE INDEX "IDX_profiles_lifecycle" ON "profiles" ("lifecycle");`,
    );
    // Partial, so the many profiles with no document on file do not all collide
    // on NULL.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_profiles_government_id_hash"
         ON "profiles" ("governmentIdHash") WHERE "governmentIdHash" IS NOT NULL;`,
    );

    // ---- bookings: the full lifecycle --------------------------------------
    await queryRunner.query(`ALTER TYPE "bookings_status_enum" RENAME TO "bookings_status_enum_old";`);
    await queryRunner.query(
      `CREATE TYPE "bookings_status_enum"
         AS ENUM ('requested','quotation_sent','quotation_accepted','payment_pending','pending',
                  'confirmed','in_progress','completed','disputed','cancelled');`,
    );
    await queryRunner.query(`ALTER TABLE "bookings" ALTER COLUMN "status" DROP DEFAULT;`);
    await queryRunner.query(
      `ALTER TABLE "bookings" ALTER COLUMN "status" TYPE "bookings_status_enum" USING "status"::text::"bookings_status_enum";`,
    );
    await queryRunner.query(`ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'requested';`);
    await queryRunner.query(`DROP TYPE "bookings_status_enum_old";`);

    // ---- payments: milestones and disputes ---------------------------------
    await queryRunner.query(`ALTER TYPE "payments_status_enum" RENAME TO "payments_status_enum_old";`);
    await queryRunner.query(
      `CREATE TYPE "payments_status_enum"
         AS ENUM ('initiated','held_in_escrow','disputed','released','refunded','partially_settled','failed');`,
    );
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "status" DROP DEFAULT;`);
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "status" TYPE "payments_status_enum" USING "status"::text::"payments_status_enum";`,
    );
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'initiated';`);
    await queryRunner.query(`DROP TYPE "payments_status_enum_old";`);

    await queryRunner.query(
      `CREATE TYPE "payments_milestone_enum" AS ENUM ('advance','second','final');`,
    );
    // Existing payments were the whole amount up front, which is exactly what
    // the advance means, so they map to it cleanly.
    await queryRunner.query(
      `ALTER TABLE "payments"
         ADD COLUMN "milestone" "payments_milestone_enum" NOT NULL DEFAULT 'advance';`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_payments_milestone" ON "payments" ("milestone");`,
    );
    // One live hold per instalment. A failed or refunded attempt frees the slot,
    // so a retry after a gateway failure still works.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_payments_booking_milestone_live"
        ON "payments" ("bookingId","milestone")
        WHERE "status" IN ('initiated','held_in_escrow','disputed','released','partially_settled');`);

    // ---- quotations ---------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "quotations_status_enum"
         AS ENUM ('sent','accepted','rejected','expired','superseded');`,
    );
    await queryRunner.query(`
      CREATE TABLE "quotations" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "bookingId" uuid NOT NULL,
        "issuedByUserId" uuid NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "currency" varchar NOT NULL DEFAULT 'INR',
        "lines" jsonb NOT NULL DEFAULT '[]',
        "notes" text,
        "validUntil" timestamptz,
        "status" "quotations_status_enum" NOT NULL DEFAULT 'sent',
        "respondedByUserId" uuid,
        "respondedAt" timestamptz,
        "responseNote" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_quotations_booking"
          FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_quotations_issued_by"
          FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE CASCADE
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_quotations_booking" ON "quotations" ("bookingId");`);
    await queryRunner.query(`CREATE INDEX "IDX_quotations_status" ON "quotations" ("status");`);

    // ---- vendors: compliance and the calendar ------------------------------
    await queryRunner.query(`
      ALTER TABLE "vendors"
        ADD COLUMN "gstNumber" varchar(15),
        ADD COLUMN "panNumber" varchar(10),
        ADD COLUMN "registrationNumber" varchar,
        ADD COLUMN "registeredAddress" text,
        ADD COLUMN "contactPhone" varchar,
        ADD COLUMN "complianceDocuments" jsonb NOT NULL DEFAULT '[]';`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vendors_gst_number"
         ON "vendors" ("gstNumber") WHERE "gstNumber" IS NOT NULL;`,
    );
    await queryRunner.query(`
      CREATE TABLE "vendor_availability" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "vendorId" uuid NOT NULL,
        "date" date NOT NULL,
        "capacity" integer NOT NULL DEFAULT 1,
        "booked" integer NOT NULL DEFAULT 0,
        "note" varchar,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_vendor_availability_vendor_date" UNIQUE ("vendorId","date"),
        CONSTRAINT "FK_vendor_availability_vendor"
          FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_vendor_availability_booked" CHECK ("booked" <= "capacity")
      );`);
    await queryRunner.query(
      `CREATE INDEX "IDX_vendor_availability_date" ON "vendor_availability" ("date");`,
    );

    // ---- agency fees --------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "agent_charges_type_enum" AS ENUM ('profile_creation','match_settlement');`,
    );
    await queryRunner.query(`
      CREATE TABLE "agent_charges" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "agentUserId" uuid NOT NULL,
        "profileId" uuid NOT NULL,
        "payerUserId" uuid,
        "type" "agent_charges_type_enum" NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "commissionAmount" numeric(12,2) NOT NULL DEFAULT 0,
        "payoutAmount" numeric(12,2) NOT NULL DEFAULT 0,
        "currency" varchar NOT NULL DEFAULT 'INR',
        "status" "payments_status_enum" NOT NULL DEFAULT 'initiated',
        "providerRef" varchar,
        "interestId" uuid,
        "paidAt" timestamptz,
        "releasedAt" timestamptz,
        "notes" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_agent_charges_agent"
          FOREIGN KEY ("agentUserId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_charges_profile"
          FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_agent_charges_agent" ON "agent_charges" ("agentUserId");`);
    await queryRunner.query(`CREATE INDEX "IDX_agent_charges_profile" ON "agent_charges" ("profileId");`);
    await queryRunner.query(`CREATE INDEX "IDX_agent_charges_status" ON "agent_charges" ("status");`);
    await queryRunner.query(`CREATE INDEX "IDX_agent_charges_type" ON "agent_charges" ("type");`);
    await queryRunner.query(`CREATE INDEX "IDX_agent_charges_interest" ON "agent_charges" ("interestId");`);
    // One profile fee per profile, so re-editing a client's details can never
    // bill them twice.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_agent_charges_profile_creation"
        ON "agent_charges" ("profileId") WHERE "type" = 'profile_creation';`);

    // ---- chat: redaction counter -------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "messages" ADD COLUMN "redactedCount" integer NOT NULL DEFAULT 0;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "redactedCount";`);

    await queryRunner.query(`DROP TABLE IF EXISTS "agent_charges";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "agent_charges_type_enum";`);

    await queryRunner.query(`DROP TABLE IF EXISTS "vendor_availability";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_vendors_gst_number";`);
    await queryRunner.query(`
      ALTER TABLE "vendors"
        DROP COLUMN "gstNumber",
        DROP COLUMN "panNumber",
        DROP COLUMN "registrationNumber",
        DROP COLUMN "registeredAddress",
        DROP COLUMN "contactPhone",
        DROP COLUMN "complianceDocuments";`);

    await queryRunner.query(`DROP TABLE IF EXISTS "quotations";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "quotations_status_enum";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_payments_booking_milestone_live";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_milestone";`);
    await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "milestone";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payments_milestone_enum";`);

    // Anything that moved into a state this schema introduced has to be brought
    // back to one the old enum knows about before the type is swapped, or the
    // cast fails and the rollback dies half-done.
    await queryRunner.query(
      `UPDATE "payments" SET "status" = 'held_in_escrow' WHERE "status" IN ('disputed','partially_settled');`,
    );
    await queryRunner.query(`ALTER TYPE "payments_status_enum" RENAME TO "payments_status_enum_new";`);
    await queryRunner.query(
      `CREATE TYPE "payments_status_enum" AS ENUM ('initiated','held_in_escrow','released','refunded','failed');`,
    );
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "status" DROP DEFAULT;`);
    await queryRunner.query(
      `ALTER TABLE "payments" ALTER COLUMN "status" TYPE "payments_status_enum" USING "status"::text::"payments_status_enum";`,
    );
    await queryRunner.query(`ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'initiated';`);
    await queryRunner.query(`DROP TYPE "payments_status_enum_new";`);

    await queryRunner.query(`
      UPDATE "bookings" SET "status" = CASE
        WHEN "status" IN ('quotation_sent','quotation_accepted','payment_pending') THEN 'requested'
        WHEN "status" = 'in_progress' THEN 'confirmed'
        WHEN "status" = 'disputed' THEN 'completed'
        ELSE "status" END::text::"bookings_status_enum"
      WHERE "status" IN ('quotation_sent','quotation_accepted','payment_pending','in_progress','disputed');`);
    await queryRunner.query(`ALTER TYPE "bookings_status_enum" RENAME TO "bookings_status_enum_new";`);
    await queryRunner.query(
      `CREATE TYPE "bookings_status_enum" AS ENUM ('requested','pending','confirmed','completed','cancelled');`,
    );
    await queryRunner.query(`ALTER TABLE "bookings" ALTER COLUMN "status" DROP DEFAULT;`);
    await queryRunner.query(
      `ALTER TABLE "bookings" ALTER COLUMN "status" TYPE "bookings_status_enum" USING "status"::text::"bookings_status_enum";`,
    );
    await queryRunner.query(`ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'requested';`);
    await queryRunner.query(`DROP TYPE "bookings_status_enum_new";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_profiles_government_id_hash";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_lifecycle";`);
    await queryRunner.query(`
      ALTER TABLE "profiles"
        DROP COLUMN "lifecycle",
        DROP COLUMN "deactivatedAt",
        DROP COLUMN "archivedAt",
        DROP COLUMN "lifecycleReason",
        DROP COLUMN "governmentIdType",
        DROP COLUMN "governmentIdHash",
        DROP COLUMN "governmentIdLast4",
        DROP COLUMN "idSubmittedAt",
        DROP COLUMN "idVerifiedAt",
        DROP COLUMN "idVerifiedByUserId";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "profiles_governmentidtype_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "profiles_lifecycle_enum";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_interests_match_fixed_state";`);
    await queryRunner.query(`
      ALTER TABLE "interests"
        DROP COLUMN "matchFixedState",
        DROP COLUMN "fixedConfirmedFromAt",
        DROP COLUMN "fixedConfirmedToAt",
        DROP COLUMN "matchFixedAt",
        DROP COLUMN "endedByUserId",
        DROP COLUMN "endedReason";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "interests_matchfixedstate_enum";`);

    // The three statuses this migration added have no equivalent in the old
    // enum, so the rows are deleted rather than silently reinterpreted as
    // something they are not. Losing them is bad; recording a block as a
    // rejection is worse.
    await queryRunner.query(
      `DELETE FROM "interests" WHERE "status" IN ('withdrawn','unmatched','blocked');`,
    );
    await queryRunner.query(`ALTER TYPE "interests_status_enum" RENAME TO "interests_status_enum_new";`);
    await queryRunner.query(
      `CREATE TYPE "interests_status_enum" AS ENUM ('pending','accepted','rejected');`,
    );
    await queryRunner.query(`ALTER TABLE "interests" ALTER COLUMN "status" DROP DEFAULT;`);
    await queryRunner.query(
      `ALTER TABLE "interests" ALTER COLUMN "status" TYPE "interests_status_enum" USING "status"::text::"interests_status_enum";`,
    );
    await queryRunner.query(`ALTER TABLE "interests" ALTER COLUMN "status" SET DEFAULT 'pending';`);
    await queryRunner.query(`DROP TYPE "interests_status_enum_new";`);

    await queryRunner.query(`DROP TABLE IF EXISTS "support_cases";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "support_cases_settlementoutcome_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "support_cases_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "support_cases_subjecttype_enum";`);

    await queryRunner.query(`DROP TABLE IF EXISTS "verification_requests";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "verification_requests_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "verification_requests_applicanttype_enum";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_onboarding_stage";`);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "mustResetPassword",
        DROP COLUMN "isProvisioned",
        DROP COLUMN "onboardingStage",
        DROP COLUMN "matchInterestId",
        DROP COLUMN "tokenVersion";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "users_onboardingstage_enum";`);

    // Verification officers have no equivalent role in the old enum, so their
    // accounts are deactivated rather than deleted: their decisions and case
    // history stay attributable.
    await queryRunner.query(
      `UPDATE "users" SET "role" = 'admin', "isActive" = false WHERE "role" = 'in_person';`,
    );
    await queryRunner.query(`ALTER TYPE "users_role_enum" RENAME TO "users_role_enum_new";`);
    await queryRunner.query(
      `CREATE TYPE "users_role_enum"
         AS ENUM ('bride','groom','family','agent','vendor','planner','admin');`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "users_role_enum" USING "role"::text::"users_role_enum";`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'bride';`);
    await queryRunner.query(`DROP TYPE "users_role_enum_new";`);
  }
}
