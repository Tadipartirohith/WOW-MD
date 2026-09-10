import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Delivery evidence and the buyer's acceptance of it (EZ1-I228).
 *
 * "Mark as delivered" recorded a status change and nothing else, and escrow
 * became releasable once the balance arrived — which records that the buyer
 * paid, not that they agreed the work was done. These four columns carry both
 * facts: what the provider handed over, and whether the buyer accepted it.
 *
 * All nullable (and the evidence list defaulted) so every booking that
 * completed before this existed loads and settles exactly as it did.
 */
export class Phase50BookingDelivery1710000075000 implements MigrationInterface {
  name = 'Phase50BookingDelivery1710000075000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bookings"
         ADD COLUMN IF NOT EXISTS "deliveredAt" timestamptz,
         ADD COLUMN IF NOT EXISTS "deliveryNotes" text,
         ADD COLUMN IF NOT EXISTS "deliveryEvidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
         ADD COLUMN IF NOT EXISTS "deliveryAcceptedAt" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bookings"
         DROP COLUMN IF EXISTS "deliveredAt",
         DROP COLUMN IF EXISTS "deliveryNotes",
         DROP COLUMN IF EXISTS "deliveryEvidence",
         DROP COLUMN IF EXISTS "deliveryAcceptedAt"`,
    );
  }
}
