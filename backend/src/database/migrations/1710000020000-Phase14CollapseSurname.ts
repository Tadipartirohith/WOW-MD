import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One name field where there were two.
 *
 * The previous specification asked for surname and last name to be
 * distinguished — in much of India the house or gothram name and the family
 * name are different words — and that is what was built. This one asks for a
 * single field, and that is the decision taken.
 *
 * The migration is careful about which one survives, because both directions
 * lose something:
 *
 * - Where `lastName` is empty, the surname moves into it. Somebody who filled
 *   in only the surname does not lose their name.
 * - Where both are filled, `lastName` is kept. It is the name on the documents,
 *   which is what a verification officer and a marriage registrar work from.
 * - Where they are the same word — the reported symptom — nothing changes.
 *
 * The column is not dropped. Reversing this would otherwise be lossy, and a
 * column nobody reads costs nothing to keep for one release.
 */
export class Phase14CollapseSurname1710000020000 implements MigrationInterface {
  name = 'Phase14CollapseSurname1710000020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const moved = await queryRunner.query(`
      UPDATE "profile_details"
      SET "lastName" = "surname"
      WHERE "surname" IS NOT NULL
        AND btrim("surname") <> ''
        AND ("lastName" IS NULL OR btrim("lastName") = '')
      RETURNING "profileId"
    `);
    // eslint-disable-next-line no-console
    console.log(`[migration] surnames promoted to last name: ${moved?.length ?? 0}`);
  }

  public async down(): Promise<void> {
    // The surname column was never dropped, so the values that were copied into
    // `lastName` are still where they were. Nothing to undo.
  }
}
