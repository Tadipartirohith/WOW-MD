import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 schema: bookings/payments, events/guests/RSVP, travel/honeymoon,
 * media/memories, and admin disputes.
 */
export class Phase2Schema1710000001000 implements MigrationInterface {
  name = 'Phase2Schema1710000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "bookings_status_enum" AS ENUM ('requested','pending','confirmed','completed','cancelled');`);
    await queryRunner.query(`CREATE TYPE "payments_status_enum" AS ENUM ('initiated','held_in_escrow','released','refunded','failed');`);
    await queryRunner.query(`CREATE TYPE "event_invites_status_enum" AS ENUM ('invited','attending','declined','maybe');`);
    await queryRunner.query(`CREATE TYPE "media_items_type_enum" AS ENUM ('image','video');`);
    await queryRunner.query(`CREATE TYPE "disputes_status_enum" AS ENUM ('open','resolved','rejected');`);

    await queryRunner.query(`
      CREATE TABLE "bookings" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "vendorId" uuid NOT NULL,
        "status" "bookings_status_enum" NOT NULL DEFAULT 'requested',
        "amount" numeric(12,2) NOT NULL DEFAULT 0,
        "currency" varchar NOT NULL DEFAULT 'INR',
        "eventDate" date,
        "notes" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_bookings_user" ON "bookings" ("userId");`);
    await queryRunner.query(`CREATE INDEX "IDX_bookings_vendor" ON "bookings" ("vendorId");`);
    await queryRunner.query(`CREATE INDEX "IDX_bookings_status" ON "bookings" ("status");`);

    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "bookingId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "currency" varchar NOT NULL DEFAULT 'INR',
        "status" "payments_status_enum" NOT NULL DEFAULT 'initiated',
        "provider" varchar NOT NULL,
        "providerRef" varchar,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_payments_booking" ON "payments" ("bookingId");`);
    await queryRunner.query(`CREATE INDEX "IDX_payments_user" ON "payments" ("userId");`);
    await queryRunner.query(`CREATE INDEX "IDX_payments_status" ON "payments" ("status");`);

    await queryRunner.query(`
      CREATE TABLE "events" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "name" varchar NOT NULL,
        "eventDate" date,
        "venue" varchar,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_events_user" ON "events" ("userId");`);

    await queryRunner.query(`
      CREATE TABLE "guests" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "name" varchar NOT NULL,
        "contact" varchar,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_guests_user" ON "guests" ("userId");`);

    await queryRunner.query(`
      CREATE TABLE "event_invites" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "eventId" uuid NOT NULL,
        "guestId" uuid NOT NULL,
        "status" "event_invites_status_enum" NOT NULL DEFAULT 'invited',
        "seat" varchar,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_event_invites" UNIQUE ("eventId","guestId")
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_event_invites_event" ON "event_invites" ("eventId");`);
    await queryRunner.query(`CREATE INDEX "IDX_event_invites_guest" ON "event_invites" ("guestId");`);

    await queryRunner.query(`
      CREATE TABLE "destinations" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "name" varchar NOT NULL,
        "country" varchar,
        "description" text,
        "imageUrl" varchar,
        "tags" jsonb NOT NULL DEFAULT '[]'
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_destinations_country" ON "destinations" ("country");`);

    await queryRunner.query(`
      CREATE TABLE "travel_packages" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "destinationId" uuid NOT NULL,
        "title" varchar NOT NULL,
        "price" numeric(12,2) NOT NULL DEFAULT 0,
        "nights" integer NOT NULL DEFAULT 1,
        "inclusions" jsonb NOT NULL DEFAULT '[]'
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_travel_packages_dest" ON "travel_packages" ("destinationId");`);

    await queryRunner.query(`
      CREATE TABLE "itineraries" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "packageId" uuid,
        "title" varchar NOT NULL,
        "items" jsonb NOT NULL DEFAULT '[]',
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_itineraries_user" ON "itineraries" ("userId");`);

    await queryRunner.query(`
      CREATE TABLE "albums" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "title" varchar NOT NULL,
        "isPublic" boolean NOT NULL DEFAULT false,
        "shareToken" varchar NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_albums_user" ON "albums" ("userId");`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_albums_shareToken" ON "albums" ("shareToken");`);

    await queryRunner.query(`
      CREATE TABLE "media_items" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "albumId" uuid NOT NULL,
        "url" varchar NOT NULL,
        "type" "media_items_type_enum" NOT NULL DEFAULT 'image',
        "caption" varchar,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_media_items_album" ON "media_items" ("albumId");`);

    await queryRunner.query(`
      CREATE TABLE "disputes" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "bookingId" uuid NOT NULL,
        "raisedBy" uuid NOT NULL,
        "reason" text NOT NULL,
        "status" "disputes_status_enum" NOT NULL DEFAULT 'open',
        "resolution" text,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      );`);
    await queryRunner.query(`CREATE INDEX "IDX_disputes_booking" ON "disputes" ("bookingId");`);
    await queryRunner.query(`CREATE INDEX "IDX_disputes_status" ON "disputes" ("status");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "disputes";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "media_items";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "albums";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "itineraries";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "travel_packages";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "destinations";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "event_invites";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "guests";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "events";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payments";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bookings";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "disputes_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "media_items_type_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "event_invites_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payments_status_enum";`);
    await queryRunner.query(`DROP TYPE IF EXISTS "bookings_status_enum";`);
  }
}
