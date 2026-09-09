import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Whether a verification officer is taking new fieldwork.
 *
 * Allocation used to assume every active officer was reachable, so the
 * lightest-loaded person got the next visit even while they were away. An
 * officer now sets their own availability, and auto-allocation skips anyone who
 * is on leave today or stood down — a named manual allocation still gets
 * through.
 *
 * One row per officer, keyed by the user id: an officer either is or is not on
 * leave, so this is a single fact rather than a history. The leave window is
 * two dates or neither, which is why a booked-but-future leave does not remove
 * the officer from allocation until it starts.
 */
export class Phase47OfficerAvailability1710000071000 implements MigrationInterface {
  name = 'Phase47OfficerAvailability1710000071000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "officer_availability" (
        "officerUserId" uuid NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'available',
        "leaveFrom" date,
        "leaveTo" date,
        "leaveReason" text,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_officer_availability" PRIMARY KEY ("officerUserId"),
        CONSTRAINT "FK_officer_availability_user"
          FOREIGN KEY ("officerUserId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_officer_availability_status" CHECK (
          "status" IN ('available', 'on_leave', 'unavailable')
        )
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "officer_availability"`);
  }
}
