import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3: multi-persona accounts and real RBAC.
 *
 *  - adds the AGENT and PLANNER roles
 *  - adds users.isActive and users.managedByAgentId (agent book of business)
 *  - adds the planner_profiles listing table
 *  - generalises bookings from "vendor booking" to "provider booking"
 *    (providerType + providerId) and records who placed each booking
 *  - lets a wedding plan carry the planner engaged on it
 */
export class Phase3RbacSchema1710000002000 implements MigrationInterface {
  name = 'Phase3RbacSchema1710000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- roles -------------------------------------------------------------
    // Postgres cannot ADD VALUE inside a transaction on older versions, and
    // TypeORM wraps migrations in one, so rebuild the enum type explicitly.
    await queryRunner.query(`ALTER TYPE "users_role_enum" RENAME TO "users_role_enum_old";`);
    await queryRunner.query(
      `CREATE TYPE "users_role_enum" AS ENUM ('bride','groom','family','agent','vendor','planner','admin');`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "users_role_enum" USING "role"::text::"users_role_enum";`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'bride';`);
    await queryRunner.query(`DROP TYPE "users_role_enum_old";`);

    // --- account status + agent linkage ------------------------------------
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true;`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "managedByAgentId" uuid;`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "FK_users_managed_by_agent"
         FOREIGN KEY ("managedByAgentId") REFERENCES "users"("id") ON DELETE SET NULL;`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_users_managed_by_agent" ON "users" ("managedByAgentId");`,
    );

    // --- planner listings ---------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "planner_profiles" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "ownerUserId" uuid NOT NULL,
        "agencyName" varchar NOT NULL,
        "bio" text,
        "city" varchar,
        "servesCities" jsonb NOT NULL DEFAULT '[]',
        "packages" jsonb NOT NULL DEFAULT '[]',
        "yearsExperience" integer NOT NULL DEFAULT 0,
        "portfolio" jsonb NOT NULL DEFAULT '[]',
        "ratingAvg" double precision NOT NULL DEFAULT 0,
        "ratingCount" integer NOT NULL DEFAULT 0,
        "isApproved" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_planner_profiles_owner"
          FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE
      );`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_planner_profiles_owner" ON "planner_profiles" ("ownerUserId");`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_planner_profiles_city" ON "planner_profiles" ("city");`);
    await queryRunner.query(
      `CREATE INDEX "IDX_planner_profiles_approved" ON "planner_profiles" ("isApproved");`,
    );

    // --- bookings: vendor-only -> any provider ------------------------------
    await queryRunner.query(`CREATE TYPE "bookings_providertype_enum" AS ENUM ('vendor','planner');`);
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN "providerType" "bookings_providertype_enum" NOT NULL DEFAULT 'vendor';`,
    );
    // Existing rows are all vendor bookings, so the column rename carries them
    // across without a data backfill.
    await queryRunner.query(`ALTER TABLE "bookings" RENAME COLUMN "vendorId" TO "providerId";`);
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD COLUMN "bookedByUserId" uuid;`,
    );
    // Pre-existing bookings were always placed by the client themselves.
    await queryRunner.query(`UPDATE "bookings" SET "bookedByUserId" = "userId";`);
    await queryRunner.query(`ALTER TABLE "bookings" ALTER COLUMN "bookedByUserId" SET NOT NULL;`);
    await queryRunner.query(`ALTER TABLE "bookings" ADD COLUMN "cancellationReason" text;`);
    await queryRunner.query(
      `CREATE INDEX "IDX_bookings_booked_by" ON "bookings" ("bookedByUserId");`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bookings_provider" ON "bookings" ("providerType", "providerId");`,
    );

    // --- wedding plans: engaged planner -------------------------------------
    await queryRunner.query(`ALTER TABLE "wedding_plans" ADD COLUMN "plannerUserId" uuid;`);
    await queryRunner.query(
      `ALTER TABLE "wedding_plans" ADD CONSTRAINT "FK_wedding_plans_planner"
         FOREIGN KEY ("plannerUserId") REFERENCES "users"("id") ON DELETE SET NULL;`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_wedding_plans_planner" ON "wedding_plans" ("plannerUserId");`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_wedding_plans_planner";`);
    await queryRunner.query(
      `ALTER TABLE "wedding_plans" DROP CONSTRAINT IF EXISTS "FK_wedding_plans_planner";`,
    );
    await queryRunner.query(`ALTER TABLE "wedding_plans" DROP COLUMN IF EXISTS "plannerUserId";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bookings_provider";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bookings_booked_by";`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "cancellationReason";`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "bookedByUserId";`);
    await queryRunner.query(`ALTER TABLE "bookings" RENAME COLUMN "providerId" TO "vendorId";`);
    await queryRunner.query(`ALTER TABLE "bookings" DROP COLUMN IF EXISTS "providerType";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "bookings_providertype_enum";`);

    await queryRunner.query(`DROP TABLE IF EXISTS "planner_profiles";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_managed_by_agent";`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "FK_users_managed_by_agent";`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "managedByAgentId";`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "isActive";`);

    // Any agent/planner accounts must be reassigned before the enum narrows.
    await queryRunner.query(
      `UPDATE "users" SET "role" = 'family' WHERE "role" IN ('agent','planner');`,
    );
    await queryRunner.query(`ALTER TYPE "users_role_enum" RENAME TO "users_role_enum_new";`);
    await queryRunner.query(
      `CREATE TYPE "users_role_enum" AS ENUM ('bride','groom','family','vendor','admin');`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "users_role_enum" USING "role"::text::"users_role_enum";`,
    );
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'bride';`);
    await queryRunner.query(`DROP TYPE "users_role_enum_new";`);
  }
}
