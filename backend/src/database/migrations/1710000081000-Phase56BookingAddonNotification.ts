import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The add-on notification type (EZ1-I254).
 *
 * `booking_addon` was added to the enum in code and not to the Postgres type,
 * so every insert of one threw `invalid input value for enum` and was swallowed
 * by the notification writer's catch: a customer asked for an add-on and the
 * vendor was never told. The same mistake Phase43 fixed for EZ1-I159.
 *
 * IF NOT EXISTS keeps a re-run harmless.
 */
export class Phase56BookingAddonNotification1710000081000 implements MigrationInterface {
  name = 'Phase56BookingAddonNotification1710000081000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'booking_addon'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres cannot remove a value from an enum type. The value stays in the
    // definition; nothing references it after a rollback.
  }
}
