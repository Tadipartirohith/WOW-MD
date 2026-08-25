import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Conversations gain a booking.
 *
 * The table held one thread per pair of accounts, enforced by a plain unique
 * constraint. A vendor with three jobs for the same family had one thread for
 * all three, and there was nowhere to hang the rules a booking's thread needs:
 * it opens when the advance is held and stops taking messages when the job is
 * done.
 *
 * The uniqueness becomes two partial indexes rather than a unique on three
 * columns, because NULLs never collide in a Postgres unique index — `(a, b,
 * NULL)` would permit any number of duplicate direct threads, which is the one
 * thing the original constraint existed to prevent.
 */
export class Phase16BookingThreads1710000025000 implements MigrationInterface {
  name = 'Phase16BookingThreads1710000025000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "bookingId" uuid;`);

    // TypeORM named the pair constraint; drop by lookup rather than by a name
    // that differs between a migrated database and a synchronised one.
    await queryRunner.query(`
      DO $$
      DECLARE con text;
      BEGIN
        SELECT conname INTO con
          FROM pg_constraint
         WHERE conrelid = 'conversations'::regclass
           AND contype = 'u'
           AND array_length(conkey, 1) = 2;
        IF con IS NOT NULL THEN
          EXECUTE format('ALTER TABLE "conversations" DROP CONSTRAINT %I', con);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_conversations_direct"
        ON "conversations" ("participantA", "participantB")
        WHERE "bookingId" IS NULL;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_conversations_booking"
        ON "conversations" ("participantA", "participantB", "bookingId")
        WHERE "bookingId" IS NOT NULL;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_conversations_booking"
        ON "conversations" ("bookingId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Booking threads have to go before the pair constraint can come back:
    // two threads between the same pair are exactly what it forbids.
    await queryRunner.query(`DELETE FROM "messages" WHERE "conversationId" IN (
      SELECT "id" FROM "conversations" WHERE "bookingId" IS NOT NULL
    );`);
    await queryRunner.query(`DELETE FROM "conversations" WHERE "bookingId" IS NOT NULL;`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_conversations_booking";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_conversations_booking";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_conversations_direct";`);
    await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "bookingId";`);
    await queryRunner.query(`
      ALTER TABLE "conversations"
        ADD CONSTRAINT "UQ_conversations_pair" UNIQUE ("participantA", "participantB");
    `);
  }
}
