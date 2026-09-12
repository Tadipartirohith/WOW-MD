import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An account may have no email address (EZ1-I233).
 *
 * A great many clients an agency takes on are signed up by mobile number
 * alone: the profile carries a number and no address, the invitation goes out
 * by SMS, and the claim form then demanded an email the client had never given
 * and in many cases does not have. They invented one or gave up.
 *
 * Only the NOT NULL goes. The unique index stays exactly as it was, because
 * Postgres treats NULLs as distinct in a unique index -- two accounts still
 * cannot share an address, and any number of accounts may have none.
 *
 * Nothing is back-filled and no existing row changes.
 */
export class Phase53OptionalUserEmail1710000078000 implements MigrationInterface {
  name = 'Phase53OptionalUserEmail1710000078000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL`);
  }

  /**
   * Refuses to go back while any account relies on it.
   *
   * Restoring NOT NULL with address-less accounts present would fail on the
   * constraint anyway; failing with a sentence that says why is friendlier
   * than a bare constraint violation, and there is no honest value to
   * back-fill -- an invented address would be a login credential nobody holds.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = (await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM "users" WHERE "email" IS NULL`,
    )) as { count: number }[];

    if (count > 0) {
      throw new Error(
        `${count} account(s) have no email address, which is what this migration allows. ` +
          'Give them addresses before reverting it.',
      );
    }
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL`);
  }
}
