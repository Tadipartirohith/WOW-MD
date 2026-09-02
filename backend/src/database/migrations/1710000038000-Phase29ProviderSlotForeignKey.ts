import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the foreign key a polymorphic column cannot satisfy.
 *
 * Phase 27 renamed `vendorId` to `providerId` and added `providerType`, so the
 * column now holds either a vendor id or a planner-profile id. It did not touch
 * the constraint, which still read
 *
 *   FOREIGN KEY ("providerId") REFERENCES vendors(id)
 *
 * so every planner slot was rejected by Postgres and the API answered 500. The
 * planner availability page has been unusable since that migration ran: the
 * summary loaded (it only counts rows, and there were none), and creating the
 * first slot failed.
 *
 * A column that points at two tables cannot have one foreign key, so the
 * constraint goes rather than being repointed. What it was buying — no slot
 * for a provider that does not exist, and slots removed with their provider —
 * is now the service layer's job: creation is reached through
 * `/wedding-planners/:id/availability` or its vendor equivalent, both of which
 * load the provider and refuse an unknown one before writing.
 */
export class Phase29ProviderSlotForeignKey1710000038000 implements MigrationInterface {
  name = 'Phase29ProviderSlotForeignKey1710000038000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "vendor_availability_slots"
        DROP CONSTRAINT IF EXISTS "FK_availability_slots_vendor"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Deliberately not restored.
     *
     * Putting it back would re-break every planner slot, and any planner rows
     * written since would make the ALTER itself fail. Rolling this back means
     * rolling back Phase 27 as well, which owns the polymorphic column.
     */
  }
}
