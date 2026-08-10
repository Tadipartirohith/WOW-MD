import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema. Hand-authored so the app runs with synchronize=false from the
 * first boot. Subsequent changes should use `npm run migration:generate`.
 */
export class InitSchema1710000000000 implements MigrationInterface {
  name = 'InitSchema1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    await queryRunner.query(`CREATE TYPE "users_role_enum" AS ENUM ('bride','groom','family','vendor','admin');`);
    await queryRunner.query(`CREATE TYPE "profiles_visibility_enum" AS ENUM ('public','matches_only','private');`);
    await queryRunner.query(`CREATE TYPE "interests_status_enum" AS ENUM ('pending','accepted','rejected');`);
    await queryRunner.query(`CREATE TYPE "vendors_category_enum" AS ENUM ('venue','catering','photography','decor','makeup','entertainment');`);
    await queryRunner.query(`CREATE TYPE "plan_tasks_status_enum" AS ENUM ('pending','in_progress','done');`);
    await queryRunner.query(`CREATE TYPE "notifications_type_enum" AS ENUM ('match_interest','match_accepted','new_message','task_reminder','booking_update');`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "email" varchar NOT NULL,
        "passwordHash" varchar NOT NULL,
        "role" "users_role_enum" NOT NULL DEFAULT 'bride',
        "isVerified" boolean NOT NULL DEFAULT false,
        "refreshTokenHash" varchar,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_users_email" ON "users" ("email");`);

    await queryRunner.query(`
      CREATE TABLE "profiles" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "displayName" varchar NOT NULL,
        "gender" varchar,
        "dateOfBirth" date,
        "city" varchar,
        "preferences" jsonb NOT NULL DEFAULT '{}',
        "photos" jsonb NOT NULL DEFAULT '[]',
        "bio" text,
        "visibility" "profiles_visibility_enum" NOT NULL DEFAULT 'matches_only',
        "profileCompleted" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_profiles_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      );`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_profiles_userId" ON "profiles" ("userId");`);
    await queryRunner.query(`CREATE INDEX "IDX_profiles_gender" ON "profiles" ("gender");`);
    await queryRunner.query(`CREATE INDEX "IDX_profiles_city" ON "profiles" ("city");`);
    await queryRunner.query(`CREATE INDEX "IDX_profiles_visibility" ON "profiles" ("visibility");`);

    await queryRunner.query(`
      CREATE TABLE "interests" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "fromUserId" uuid NOT NULL,
        "toUserId" uuid NOT NULL,
        "status" "interests_status_enum" NOT NULL DEFAULT 'pending',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_interests_pair" UNIQUE ("fromUserId","toUserId")
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_interests_from" ON "interests" ("fromUserId");`);
    await queryRunner.query(`CREATE INDEX "IDX_interests_to" ON "interests" ("toUserId");`);
    await queryRunner.query(`CREATE INDEX "IDX_interests_status" ON "interests" ("status");`);

    await queryRunner.query(`
      CREATE TABLE "conversations" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "participantA" uuid NOT NULL,
        "participantB" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_conversations_pair" UNIQUE ("participantA","participantB")
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_conversations_a" ON "conversations" ("participantA");`);
    await queryRunner.query(`CREATE INDEX "IDX_conversations_b" ON "conversations" ("participantB");`);

    await queryRunner.query(`
      CREATE TABLE "messages" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "conversationId" uuid NOT NULL,
        "senderId" uuid NOT NULL,
        "body" text NOT NULL,
        "mediaUrl" varchar,
        "readAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_messages_conversation" ON "messages" ("conversationId");`);
    await queryRunner.query(`CREATE INDEX "IDX_messages_sender" ON "messages" ("senderId");`);
    await queryRunner.query(`CREATE INDEX "IDX_messages_convo_created" ON "messages" ("conversationId","createdAt");`);

    await queryRunner.query(`
      CREATE TABLE "vendors" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "ownerUserId" uuid NOT NULL,
        "name" varchar NOT NULL,
        "category" "vendors_category_enum" NOT NULL,
        "description" text,
        "city" varchar,
        "pricing" jsonb NOT NULL DEFAULT '{}',
        "portfolio" jsonb NOT NULL DEFAULT '[]',
        "ratingAvg" double precision NOT NULL DEFAULT 0,
        "ratingCount" integer NOT NULL DEFAULT 0,
        "isApproved" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_vendors_owner" ON "vendors" ("ownerUserId");`);
    await queryRunner.query(`CREATE INDEX "IDX_vendors_category" ON "vendors" ("category");`);
    await queryRunner.query(`CREATE INDEX "IDX_vendors_city" ON "vendors" ("city");`);
    await queryRunner.query(`CREATE INDEX "IDX_vendors_approved" ON "vendors" ("isApproved");`);

    await queryRunner.query(`
      CREATE TABLE "vendor_reviews" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "vendorId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "rating" integer NOT NULL,
        "comment" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_vendor_reviews" UNIQUE ("vendorId","userId")
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_vendor_reviews_vendor" ON "vendor_reviews" ("vendorId");`);

    await queryRunner.query(`
      CREATE TABLE "wedding_plans" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "weddingDate" date NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_wedding_plans_user" ON "wedding_plans" ("userId");`);

    await queryRunner.query(`
      CREATE TABLE "plan_tasks" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "planId" uuid NOT NULL,
        "title" varchar NOT NULL,
        "category" varchar,
        "dueDate" date,
        "status" "plan_tasks_status_enum" NOT NULL DEFAULT 'pending',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_plan_tasks_plan" FOREIGN KEY ("planId") REFERENCES "wedding_plans"("id") ON DELETE CASCADE
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_plan_tasks_plan" ON "plan_tasks" ("planId");`);
    await queryRunner.query(`CREATE INDEX "IDX_plan_tasks_status" ON "plan_tasks" ("status");`);

    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "type" "notifications_type_enum" NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "isRead" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_notifications_user" ON "notifications" ("userId");`);
    await queryRunner.query(`CREATE INDEX "IDX_notifications_read" ON "notifications" ("isRead");`);

    await queryRunner.query(`
      CREATE TABLE "outbox_events" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "aggregateType" varchar NOT NULL,
        "eventType" varchar NOT NULL,
        "payload" jsonb NOT NULL,
        "processedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_outbox_processed" ON "outbox_events" ("processedAt");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "outbox_events";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "plan_tasks";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "wedding_plans";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vendor_reviews";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vendors";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "messages";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversations";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "interests";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "profiles";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "notifications_type_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "plan_tasks_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "vendors_category_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "interests_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "profiles_visibility_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "users_role_enum";`);
  }
}
