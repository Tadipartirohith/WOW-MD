import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What an event actually needs to be planned.
 *
 * An event had a name, a date and a venue — enough to hang a guest list off,
 * not enough to run a day. A caterer needs the times and the head count; a
 * decorator needs the venue address; the couple need to know which of the eight
 * functions is which, and what each one is costing.
 *
 * `status` is stored rather than derived from the date. "Cancelled" and
 * "completed" are decisions somebody made, and a Mehendi that was called off
 * three weeks ago is not "upcoming" merely because its date has not arrived.
 */
export class Phase14EventDetails1710000021000 implements MigrationInterface {
  name = 'Phase14EventDetails1710000021000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "events_status_enum" AS ENUM ('upcoming','ongoing','completed','cancelled')`,
    );

    await queryRunner.query(`
      ALTER TABLE "events"
      ADD COLUMN IF NOT EXISTS "eventType" character varying(60),
      ADD COLUMN IF NOT EXISTS "category" character varying(40),
      ADD COLUMN IF NOT EXISTS "venueAddress" text,
      ADD COLUMN IF NOT EXISTS "city" character varying(120),
      ADD COLUMN IF NOT EXISTS "startTime" time,
      ADD COLUMN IF NOT EXISTS "endTime" time,
      ADD COLUMN IF NOT EXISTS "expectedGuests" integer,
      ADD COLUMN IF NOT EXISTS "budget" numeric(12,2),
      ADD COLUMN IF NOT EXISTS "description" text,
      ADD COLUMN IF NOT EXISTS "imageUrl" character varying(2000),
      ADD COLUMN IF NOT EXISTS "status" "events_status_enum" NOT NULL DEFAULT 'upcoming'
    `);

    // A day is filtered by status far more often than anything else, and
    // scoped to one host every time.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_events_user_status" ON "events" ("userId", "status")
    `);

    // An event cannot end before it starts. Both null is fine — plenty of
    // functions are "sometime in the evening" until a week beforehand.
    await queryRunner.query(`
      ALTER TABLE "events"
      ADD CONSTRAINT "CHK_events_time_order" CHECK (
        "startTime" IS NULL OR "endTime" IS NULL OR "endTime" > "startTime"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "CHK_events_time_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_events_user_status"`);
    await queryRunner.query(`
      ALTER TABLE "events"
      DROP COLUMN IF EXISTS "status",
      DROP COLUMN IF EXISTS "imageUrl",
      DROP COLUMN IF EXISTS "description",
      DROP COLUMN IF EXISTS "budget",
      DROP COLUMN IF EXISTS "expectedGuests",
      DROP COLUMN IF EXISTS "endTime",
      DROP COLUMN IF EXISTS "startTime",
      DROP COLUMN IF EXISTS "city",
      DROP COLUMN IF EXISTS "venueAddress",
      DROP COLUMN IF EXISTS "category",
      DROP COLUMN IF EXISTS "eventType"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "events_status_enum"`);
  }
}
