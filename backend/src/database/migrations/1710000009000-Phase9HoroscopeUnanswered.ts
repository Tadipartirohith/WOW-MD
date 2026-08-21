import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "No horoscope" and "nobody has been asked yet" are different answers.
 *
 * The column defaulted to false, so a profile that had only had its personal
 * details filled in already counted as having answered the horoscope question —
 * and the completion report told an agent the section was done when nobody had
 * so much as opened it. Nullable, with no default, so false means somebody
 * genuinely said no.
 *
 * Existing rows are migrated to NULL only where nothing was ever entered: a row
 * with a chart already saved has plainly answered yes, and one saved as false
 * with a `horoscopeDocumentUrl` cleared alongside it went through the form.
 */
export class Phase9HoroscopeUnanswered1710000009000 implements MigrationInterface {
  name = 'Phase9HoroscopeUnanswered1710000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "profile_details" ALTER COLUMN "horoscopeAvailable" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile_details" ALTER COLUMN "horoscopeAvailable" DROP NOT NULL`,
    );
    await queryRunner.query(
      `UPDATE "profile_details"
          SET "horoscopeAvailable" = NULL
        WHERE "horoscopeAvailable" = false
          AND ("horoscope" IS NULL OR "horoscope" = '{}'::jsonb)
          AND "horoscopeDocumentUrl" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "profile_details" SET "horoscopeAvailable" = false WHERE "horoscopeAvailable" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile_details" ALTER COLUMN "horoscopeAvailable" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "profile_details" ALTER COLUMN "horoscopeAvailable" SET DEFAULT false`,
    );
  }
}
