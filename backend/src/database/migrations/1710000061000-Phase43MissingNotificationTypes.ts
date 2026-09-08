import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Notification kinds that shipped in code but were never added to the Postgres
 * enum, so every insert of one threw `invalid input value for enum` and was
 * swallowed by the fire-and-forget `.catch()` around notification writes. The
 * recipient was simply never told (EZ1-I159).
 *
 * - `verification_requested` — a business applied and is waiting to be
 *   allocated. Raised to admins from `VerificationService.raise`; its absence
 *   is why a new vendor's approval request produced no admin notification.
 * - `match_conversation` — two of an agency's clients started talking/calling
 *   (EZ1-I125).
 * - `event_changed_by_couple` / `event_changed_by_planner` — the two sides of a
 *   shared wedding event kept in step (EZ1-I84).
 *
 * IF NOT EXISTS keeps a re-run harmless, and one statement each because
 * Postgres will not let a value be added and used in the same transaction.
 */
export class Phase43MissingNotificationTypes1710000061000 implements MigrationInterface {
  name = 'Phase43MissingNotificationTypes1710000061000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const values = [
      'verification_requested',
      'match_conversation',
      'event_changed_by_couple',
      'event_changed_by_planner',
    ];

    for (const value of values) {
      await queryRunner.query(
        `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres cannot remove a value from an enum type. The added values stay
    // in the definition; nothing references them after a rollback.
  }
}
