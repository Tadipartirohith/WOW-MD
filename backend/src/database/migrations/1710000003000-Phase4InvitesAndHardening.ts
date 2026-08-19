import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 4: profiles without accounts, email invitations, and the security
 * hardening from the self-review.
 *
 *  - profiles.userId becomes nullable, gains a steward and a claim status, so
 *    an agent can build a complete matchable profile for someone who has never
 *    signed up
 *  - invitations: single-use hashed tokens that turn such a profile into a
 *    self-owned account
 *  - interests move from user ids to PROFILE ids, which is what lets unclaimed
 *    profiles take part in matchmaking
 *  - refresh_sessions (multi-device + reuse detection), email_tokens
 *    (verification / reset), audit_events, agent_profiles (agency vetting)
 *  - payments gain the commission split, an idempotency key and webhook state
 *  - event_invites gain a signed RSVP token so guests can answer without an
 *    account
 */
export class Phase4InvitesAndHardening1710000003000 implements MigrationInterface {
  name = 'Phase4InvitesAndHardening1710000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- users -------------------------------------------------------------
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "phone" varchar;`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" timestamptz;`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "failedLoginAttempts" integer NOT NULL DEFAULT 0;`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lockedUntil" timestamptz;`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfaEnabled" boolean NOT NULL DEFAULT false;`,
    );
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mfaSecret" varchar;`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordChangedAt" timestamptz;`,
    );
    // Superseded by refresh_sessions, which supports more than one device.
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "refreshTokenHash";`);

    // ---- profiles: may now exist without an account ------------------------
    await queryRunner.query(
      `CREATE TYPE "profiles_claimstatus_enum" AS ENUM ('unclaimed','invited','claimed','self');`,
    );
    await queryRunner.query(`ALTER TABLE "profiles" ALTER COLUMN "userId" DROP NOT NULL;`);
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "managedByUserId" uuid;`,
    );
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD COLUMN "claimStatus" "profiles_claimstatus_enum" NOT NULL DEFAULT 'self';`,
    );
    await queryRunner.query(`ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "contactEmail" varchar;`);
    await queryRunner.query(`ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "contactPhone" varchar;`);
    await queryRunner.query(
      `ALTER TABLE "profiles" ADD CONSTRAINT "FK_profiles_managed_by"
         FOREIGN KEY ("managedByUserId") REFERENCES "users"("id") ON DELETE SET NULL;`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_profiles_managed_by" ON "profiles" ("managedByUserId");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_profiles_claim_status" ON "profiles" ("claimStatus");`,
    );
    // Existing rows all belong to their own account.
    await queryRunner.query(`UPDATE "profiles" SET "claimStatus" = 'self' WHERE "userId" IS NOT NULL;`);
    // The unique index on userId must tolerate many NULLs (unclaimed profiles).
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_userId";`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_profiles_userId" ON "profiles" ("userId") WHERE "userId" IS NOT NULL;`,
    );

    // ---- interests: user ids -> profile ids --------------------------------
    await queryRunner.query(`ALTER TABLE "interests" ADD COLUMN "fromProfileId" uuid;`);
    await queryRunner.query(`ALTER TABLE "interests" ADD COLUMN "toProfileId" uuid;`);
    await queryRunner.query(`ALTER TABLE "interests" ADD COLUMN "sentByUserId" uuid;`);
    await queryRunner.query(`ALTER TABLE "interests" ADD COLUMN "respondedByUserId" uuid;`);
    await queryRunner.query(`
      UPDATE "interests" i
         SET "fromProfileId" = pf.id,
             "toProfileId"   = pt.id,
             "sentByUserId"  = i."fromUserId"
        FROM "profiles" pf, "profiles" pt
       WHERE pf."userId" = i."fromUserId" AND pt."userId" = i."toUserId";`);
    // Any interest whose profile could not be resolved is unusable now.
    await queryRunner.query(
      `DELETE FROM "interests" WHERE "fromProfileId" IS NULL OR "toProfileId" IS NULL;`,
    );
    await queryRunner.query(`ALTER TABLE "interests" ALTER COLUMN "fromProfileId" SET NOT NULL;`);
    await queryRunner.query(`ALTER TABLE "interests" ALTER COLUMN "toProfileId" SET NOT NULL;`);
    await queryRunner.query(`ALTER TABLE "interests" DROP COLUMN "fromUserId";`);
    await queryRunner.query(`ALTER TABLE "interests" DROP COLUMN "toUserId";`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_interests_pair" ON "interests" ("fromProfileId", "toProfileId");`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_interests_from" ON "interests" ("fromProfileId");`);
    await queryRunner.query(`CREATE INDEX "IDX_interests_to" ON "interests" ("toProfileId");`);

    // ---- invitations -------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "invitations_status_enum" AS ENUM ('pending','accepted','revoked','expired');`,
    );
    await queryRunner.query(`
      CREATE TABLE "invitations" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "profileId" uuid NOT NULL,
        "email" varchar NOT NULL,
        "phone" varchar,
        "tokenHash" varchar NOT NULL,
        "status" "invitations_status_enum" NOT NULL DEFAULT 'pending',
        "invitedByUserId" uuid NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "acceptedAt" timestamptz,
        "acceptedUserId" uuid,
        "resendCount" integer NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_invitations_profile"
          FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_invitations_inviter"
          FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE CASCADE
      );`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_invitations_token" ON "invitations" ("tokenHash");`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_invitations_profile" ON "invitations" ("profileId");`);
    await queryRunner.query(`CREATE INDEX "IDX_invitations_email" ON "invitations" ("email");`);
    await queryRunner.query(`CREATE INDEX "IDX_invitations_status" ON "invitations" ("status");`);
    await queryRunner.query(
      `CREATE INDEX "IDX_invitations_inviter" ON "invitations" ("invitedByUserId");`,
    );

    // ---- refresh sessions --------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "refresh_sessions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "tokenHash" varchar NOT NULL,
        "familyId" uuid NOT NULL,
        "userAgent" varchar(400),
        "ip" varchar(64),
        "expiresAt" timestamptz NOT NULL,
        "lastUsedAt" timestamptz,
        "revokedAt" timestamptz,
        "revokedReason" varchar,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_refresh_sessions_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      );`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_refresh_sessions_token" ON "refresh_sessions" ("tokenHash");`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_refresh_sessions_user" ON "refresh_sessions" ("userId");`);
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_sessions_family" ON "refresh_sessions" ("familyId");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_sessions_revoked" ON "refresh_sessions" ("revokedAt");`,
    );

    // ---- email tokens ------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "email_tokens_type_enum" AS ENUM ('verify_email','reset_password');`,
    );
    await queryRunner.query(`
      CREATE TABLE "email_tokens" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "type" "email_tokens_type_enum" NOT NULL,
        "tokenHash" varchar NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "usedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_email_tokens_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      );`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_email_tokens_token" ON "email_tokens" ("tokenHash");`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_email_tokens_user" ON "email_tokens" ("userId");`);
    await queryRunner.query(`CREATE INDEX "IDX_email_tokens_type" ON "email_tokens" ("type");`);

    // ---- audit events ------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "audit_events" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "actorUserId" uuid,
        "actorRole" varchar,
        "action" varchar NOT NULL,
        "resourceType" varchar,
        "resourceId" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "ip" varchar(64),
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_actor" ON "audit_events" ("actorUserId");`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_action" ON "audit_events" ("action");`);
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_resource" ON "audit_events" ("resourceType", "resourceId");`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_audit_created" ON "audit_events" ("createdAt" DESC);`);

    // ---- agency vetting ----------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "agent_profiles" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "ownerUserId" uuid NOT NULL,
        "agencyName" varchar NOT NULL,
        "registrationNumber" varchar,
        "contactPhone" varchar,
        "city" varchar,
        "about" text,
        "isApproved" boolean NOT NULL DEFAULT false,
        "approvedAt" timestamptz,
        "approvedByUserId" uuid,
        "rejectionReason" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_agent_profiles_owner"
          FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE
      );`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_agent_profiles_owner" ON "agent_profiles" ("ownerUserId");`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_agent_profiles_city" ON "agent_profiles" ("city");`);
    await queryRunner.query(
      `CREATE INDEX "IDX_agent_profiles_approved" ON "agent_profiles" ("isApproved");`,
    );

    // ---- payments: commission, idempotency, webhook state ------------------
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "commissionAmount" numeric(12,2) NOT NULL DEFAULT 0;`,
    );
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "payoutAmount" numeric(12,2) NOT NULL DEFAULT 0;`,
    );
    await queryRunner.query(`ALTER TABLE "payments" ADD COLUMN "idempotencyKey" varchar;`);
    await queryRunner.query(`ALTER TABLE "payments" ADD COLUMN "providerStatus" varchar;`);
    await queryRunner.query(`ALTER TABLE "payments" ADD COLUMN "webhookVerifiedAt" timestamptz;`);
    await queryRunner.query(
      `ALTER TABLE "payments" ADD COLUMN "updatedAt" timestamptz NOT NULL DEFAULT now();`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_payments_idempotency" ON "payments" ("idempotencyKey")
         WHERE "idempotencyKey" IS NOT NULL;`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_payments_provider_ref" ON "payments" ("providerRef");`);

    // ---- guest RSVP tokens --------------------------------------------------
    await queryRunner.query(`ALTER TABLE "event_invites" ADD COLUMN "rsvpTokenHash" varchar;`);
    await queryRunner.query(
      `ALTER TABLE "event_invites" ADD COLUMN "rsvpTokenExpiresAt" timestamptz;`,
    );
    await queryRunner.query(`ALTER TABLE "event_invites" ADD COLUMN "respondedAt" timestamptz;`);
    await queryRunner.query(
      `ALTER TABLE "event_invites" ADD COLUMN "updatedAt" timestamptz NOT NULL DEFAULT now();`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_event_invites_rsvp_token" ON "event_invites" ("rsvpTokenHash")
         WHERE "rsvpTokenHash" IS NOT NULL;`,
    );

    // ---- planner engagement is backed by a booking -------------------------
    await queryRunner.query(`ALTER TABLE "wedding_plans" ADD COLUMN "plannerBookingId" uuid;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wedding_plans" DROP COLUMN IF EXISTS "plannerBookingId";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_event_invites_rsvp_token";`);
    await queryRunner.query(`ALTER TABLE "event_invites" DROP COLUMN IF EXISTS "updatedAt";`);
    await queryRunner.query(`ALTER TABLE "event_invites" DROP COLUMN IF EXISTS "respondedAt";`);
    await queryRunner.query(`ALTER TABLE "event_invites" DROP COLUMN IF EXISTS "rsvpTokenExpiresAt";`);
    await queryRunner.query(`ALTER TABLE "event_invites" DROP COLUMN IF EXISTS "rsvpTokenHash";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_provider_ref";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_idempotency";`);
    for (const col of [
      'updatedAt',
      'webhookVerifiedAt',
      'providerStatus',
      'idempotencyKey',
      'payoutAmount',
      'commissionAmount',
    ]) {
      await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN IF EXISTS "${col}";`);
    }

    await queryRunner.query(`DROP TABLE IF EXISTS "agent_profiles";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_events";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "email_tokens";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "email_tokens_type_enum";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_sessions";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invitations";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "invitations_status_enum";`);

    // interests back to user ids
    await queryRunner.query(`ALTER TABLE "interests" ADD COLUMN "fromUserId" uuid;`);
    await queryRunner.query(`ALTER TABLE "interests" ADD COLUMN "toUserId" uuid;`);
    await queryRunner.query(`
      UPDATE "interests" i
         SET "fromUserId" = pf."userId",
             "toUserId"   = pt."userId"
        FROM "profiles" pf, "profiles" pt
       WHERE pf.id = i."fromProfileId" AND pt.id = i."toProfileId";`);
    await queryRunner.query(
      `DELETE FROM "interests" WHERE "fromUserId" IS NULL OR "toUserId" IS NULL;`,
    );
    await queryRunner.query(`ALTER TABLE "interests" ALTER COLUMN "fromUserId" SET NOT NULL;`);
    await queryRunner.query(`ALTER TABLE "interests" ALTER COLUMN "toUserId" SET NOT NULL;`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_interests_pair";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_interests_from";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_interests_to";`);
    await queryRunner.query(`ALTER TABLE "interests" DROP COLUMN IF EXISTS "respondedByUserId";`);
    await queryRunner.query(`ALTER TABLE "interests" DROP COLUMN IF EXISTS "sentByUserId";`);
    await queryRunner.query(`ALTER TABLE "interests" DROP COLUMN IF EXISTS "toProfileId";`);
    await queryRunner.query(`ALTER TABLE "interests" DROP COLUMN IF EXISTS "fromProfileId";`);

    // profiles back to account-bound only
    await queryRunner.query(`DELETE FROM "profiles" WHERE "userId" IS NULL;`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_claim_status";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_managed_by";`);
    await queryRunner.query(
      `ALTER TABLE "profiles" DROP CONSTRAINT IF EXISTS "FK_profiles_managed_by";`,
    );
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN IF EXISTS "contactPhone";`);
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN IF EXISTS "contactEmail";`);
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN IF EXISTS "claimStatus";`);
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN IF EXISTS "managedByUserId";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "profiles_claimstatus_enum";`);
    await queryRunner.query(`ALTER TABLE "profiles" ALTER COLUMN "userId" SET NOT NULL;`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_userId";`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_profiles_userId" ON "profiles" ("userId");`);

    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "refreshTokenHash" varchar;`);
    for (const col of [
      'passwordChangedAt',
      'mfaSecret',
      'mfaEnabled',
      'lockedUntil',
      'failedLoginAttempts',
      'emailVerifiedAt',
      'phone',
    ]) {
      await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "${col}";`);
    }
  }
}
