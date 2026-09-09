import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill planner engagement for bookings confirmed before the auto-engage fix
 * shipped (EZ1-I116).
 *
 * `autoEngagePlanner` links a confirmed planner booking to the couple's wedding
 * plan (setting `plannerUserId`), which is the sole thing that puts the couple
 * on the planner's My Clients list. It only runs forward, at the moment the
 * advance is paid, so every planner booking already confirmed when it shipped —
 * and every seeded one — was never engaged: the couple has paid, the booking is
 * confirmed, and the planner still sees "No confirmed clients yet".
 *
 * This engages those existing bookings once, mirroring `autoEngagePlanner`
 * exactly: the earliest confirmed/in-progress/completed planner booking per
 * couple wins, a couple with no plan gets one created (dated to the booking's
 * event when it has one), and a plan already engaged to some planner is left
 * untouched.
 */
export class Phase44BackfillPlannerEngagement1710000062000 implements MigrationInterface {
  name = 'Phase44BackfillPlannerEngagement1710000062000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The earliest confirmed planner booking per couple — the one real-world
    // order would have engaged first. Reused by both statements below.
    const earliestPerCouple = `
      SELECT DISTINCT ON (b."userId")
             b."userId"        AS user_id,
             b."eventDate"     AS event_date,
             b.id              AS booking_id,
             pl."ownerUserId"  AS planner_user_id
      FROM bookings b
      JOIN planner_profiles pl ON pl.id = b."providerId"
      WHERE b."providerType" = 'planner'
        AND b.status IN ('confirmed', 'in_progress', 'completed')
      ORDER BY b."userId", b."createdAt" ASC
    `;

    // Couples who booked and paid a planner before ever starting a plan: create
    // the plan the paid booking implies and engage it.
    await queryRunner.query(`
      INSERT INTO wedding_plans ("userId", "weddingDate", "plannerUserId", "plannerBookingId")
      SELECT e.user_id, e.event_date, e.planner_user_id, e.booking_id
      FROM (${earliestPerCouple}) e
      WHERE NOT EXISTS (SELECT 1 FROM wedding_plans wp WHERE wp."userId" = e.user_id)
    `);

    // Couples who already had a plan but no planner engaged on it: engage it.
    // A plan already engaged to a planner is theirs to release and is left alone.
    await queryRunner.query(`
      UPDATE wedding_plans wp
      SET "plannerUserId" = e.planner_user_id,
          "plannerBookingId" = e.booking_id
      FROM (${earliestPerCouple}) e
      WHERE wp."userId" = e.user_id
        AND wp."plannerUserId" IS NULL
    `);
  }

  public async down(): Promise<void> {
    // One-time data backfill; nothing to reverse. Un-setting plannerUserId would
    // wrongly drop clients a planner has since been working with.
  }
}
