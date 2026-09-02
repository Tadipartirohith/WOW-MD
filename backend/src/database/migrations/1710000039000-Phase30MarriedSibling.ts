import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a sibling be recorded as married.
 *
 * `marital_status_enum` was written for the person the profile is about, where
 * "married" is not an available answer — somebody seeking a match is not
 * currently married, and divorced, widowed, separated and annulled cover how
 * they got here. Siblings share the type and are not seeking anything, so the
 * commonest answer about a brother or sister could not be given at all. The
 * siblings table has carried a `spouseName` column the whole time, which says
 * plainly that this was always meant to be possible.
 *
 * The value is added to the shared type; keeping it away from the profile
 * owner's own status is done in the DTO, where the rule is a sentence rather
 * than a schema constraint that would also have to be taught about siblings.
 */
export class Phase30MarriedSibling1710000039000 implements MigrationInterface {
  name = 'Phase30MarriedSibling1710000039000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // IF NOT EXISTS so a re-run is harmless; ADD VALUE cannot run inside a
    // transaction block on older Postgres, and this is the form that works on
    // 16 without one.
    await queryRunner.query(`ALTER TYPE "marital_status_enum" ADD VALUE IF NOT EXISTS 'married'`);
  }

  public async down(): Promise<void> {
    /*
     * Postgres cannot drop an enum value.
     *
     * Reversing it would mean rebuilding the type and rewriting every column
     * that uses it, having first decided what to do with the rows that say
     * 'married'. Not worth carrying for a value whose presence harms nothing.
     */
  }
}
