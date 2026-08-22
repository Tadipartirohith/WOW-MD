import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where each verification officer will actually travel.
 *
 * Allocation ranked purely on open workload, which is fine until the
 * lightest-loaded officer is four hundred kilometres from the kitchen they have
 * been sent to inspect. Recording a single `region` string on the officer and
 * comparing it to the applicant's city would have been worse than ignoring
 * geography: a near-miss reads as *no* coverage and silently sends the visit to
 * the wrong person.
 *
 * So coverage is rows, at two granularities — a city, or a whole state — and
 * both are stored already normalised, because the alternative is matching free
 * text typed by two administrators on two different days.
 *
 * The unique index is on the normalised pair, which is what stops "Bangalore"
 * and "Bengaluru" being added to the same officer as two separate areas.
 */
export class Phase13OfficerServiceAreas1710000018000 implements MigrationInterface {
  name = 'Phase13OfficerServiceAreas1710000018000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "officer_service_areas" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "officerUserId" uuid NOT NULL,
        "city" character varying(120),
        "state" character varying(120),
        "label" character varying(200) NOT NULL,
        "primary" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_officer_service_areas" PRIMARY KEY ("id"),
        CONSTRAINT "FK_officer_service_areas_user"
          FOREIGN KEY ("officerUserId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_officer_service_areas_place" CHECK (
          "city" IS NOT NULL OR "state" IS NOT NULL
        )
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_officer_service_areas_officer" ON "officer_service_areas" ("officerUserId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_officer_service_areas_city" ON "officer_service_areas" ("city")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_officer_service_areas_state" ON "officer_service_areas" ("state")`,
    );

    // NULLS NOT DISTINCT: a city row and a state row both leave one column
    // null, and without it Postgres treats every such pair as unique and the
    // duplicate check never fires.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_officer_service_areas_place"
      ON "officer_service_areas" ("officerUserId", "city", "state") NULLS NOT DISTINCT
    `);

    // What the allocation went on, kept on the request so a staffing gap is
    // visible after the fact rather than only at the moment of allocation.
    await queryRunner.query(`
      ALTER TABLE "verification_requests"
      ADD COLUMN IF NOT EXISTS "allocationBasis" character varying(32),
      ADD COLUMN IF NOT EXISTS "applicantCity" character varying(120)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "verification_requests"
      DROP COLUMN IF EXISTS "applicantCity",
      DROP COLUMN IF EXISTS "allocationBasis"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "officer_service_areas"`);
  }
}
