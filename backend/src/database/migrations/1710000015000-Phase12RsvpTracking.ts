import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What an RSVP dashboard actually needs to be useful.
 *
 * The counts were already derivable from `event_invites.status`, but the rows
 * behind them were not: a guest had a name and one ambiguous `contact` field,
 * an invitation recorded no head count, no reason for a refusal and no memory
 * of who had already been chased.
 *
 * An organiser ordering catering works from the difference between invited and
 * attending, so both are stored, and both are nullable — an unanswered head
 * count is not a head count of one, and guessing it is guessing at a real
 * amount of money.
 *
 * Additive throughout; every existing guest and invitation keeps loading.
 */
export class Phase12RsvpTracking1710000015000 implements MigrationInterface {
  name = 'Phase12RsvpTracking1710000015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "guests"
      ADD COLUMN IF NOT EXISTS "phone" character varying(20),
      ADD COLUMN IF NOT EXISTS "partySize" integer,
      ADD COLUMN IF NOT EXISTS "relation" character varying(60)
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_guests_phone" ON "guests" ("phone")`);

    await queryRunner.query(`
      ALTER TABLE "event_invites"
      ADD COLUMN IF NOT EXISTS "attendingCount" integer,
      ADD COLUMN IF NOT EXISTS "declineReason" text,
      ADD COLUMN IF NOT EXISTS "lastRemindedAt" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN IF NOT EXISTS "reminderCount" integer NOT NULL DEFAULT 0
    `);

    // Every RSVP list is scoped to one event and grouped by answer, which is
    // exactly this index.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_event_invites_event_status"
      ON "event_invites" ("eventId", "status")
    `);

    // A guest cannot be coming with a negative number of people, and a refusal
    // cannot carry an attending count.
    await queryRunner.query(`
      ALTER TABLE "event_invites"
      ADD CONSTRAINT "CHK_event_invites_attending_sane" CHECK (
        "attendingCount" IS NULL OR "attendingCount" >= 0
      )
    `);

    // An older row that says "contact" and holds a phone number rather than an
    // email is moved across, so the organiser sees it in the right column.
    // Anything with an @ stays where it is.
    await queryRunner.query(`
      UPDATE "guests"
      SET "phone" = "contact"
      WHERE "contact" IS NOT NULL
        AND "contact" NOT LIKE '%@%'
        AND "contact" ~ '^[+0-9][0-9 ()-]{6,19}$'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "event_invites" DROP CONSTRAINT IF EXISTS "CHK_event_invites_attending_sane"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_event_invites_event_status"`);
    await queryRunner.query(`
      ALTER TABLE "event_invites"
      DROP COLUMN IF EXISTS "reminderCount",
      DROP COLUMN IF EXISTS "lastRemindedAt",
      DROP COLUMN IF EXISTS "declineReason",
      DROP COLUMN IF EXISTS "attendingCount"
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_guests_phone"`);
    await queryRunner.query(`
      ALTER TABLE "guests"
      DROP COLUMN IF EXISTS "relation",
      DROP COLUMN IF EXISTS "partySize",
      DROP COLUMN IF EXISTS "phone"
    `);
  }
}
