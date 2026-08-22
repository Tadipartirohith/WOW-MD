import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The notification kinds the booking and verification flows actually produce.
 *
 * Everything used to arrive as one `booking_update`, which meant a vendor
 * could not tell from the list whether anything needed them — and that is the
 * entire job of a notifications page. Splitting by what the recipient has to
 * *do* is what makes the page readable.
 *
 * `booking_update` stays in the type: rows written before this exist, and
 * dropping a value out of a Postgres enum is not something you can do anyway.
 */
export class Phase12NotificationTypes1710000017000 implements MigrationInterface {
  name = 'Phase12NotificationTypes1710000017000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const values = [
      'booking_request',
      'booking_quotation',
      'booking_confirmed',
      'booking_payment',
      'booking_started',
      'booking_completed',
      'booking_cancelled',
      'verification_assigned',
      'verification_decided',
      'verification_submitted',
      'dispute_update',
    ];

    // One statement each: Postgres will not let a value be added and used in
    // the same transaction, and IF NOT EXISTS keeps a re-run harmless.
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
