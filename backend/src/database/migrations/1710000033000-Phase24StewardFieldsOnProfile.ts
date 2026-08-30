import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Managing profile for", on the steward's own profile.
 *
 * `stewardRelation` already existed but only on the *managed* profile, set by
 * an agent building somebody else's record. A family member filling in their
 * own account page had nowhere to say either of the two things everyone asks
 * them first: whether they are here for a bride or a groom, and what they are
 * to that person.
 */
export class Phase24StewardFieldsOnProfile1710000033000 implements MigrationInterface {
  name = 'Phase24StewardFieldsOnProfile1710000033000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profiles" ADD COLUMN "managingFor" varchar(20)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "profiles" DROP COLUMN IF EXISTS "managingFor"`);
  }
}
