import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Devices to reach somebody on, and consent to reach them on WhatsApp.
 *
 * `whatsappOptIn` defaults to false for every existing account, and there is
 * deliberately no back-fill from "has a phone number". A number given so the
 * platform could verify it is not consent to be messaged on WhatsApp; treating
 * it as consent is both what users hate and what gets a business number blocked
 * by Meta.
 *
 * Push tokens are unique on the token rather than on (user, token): the token
 * belongs to an app installation, not to a person, so a handed-over phone or a
 * sign-out and sign-in produces the same token under a new owner. A row per
 * owner would send one person another person's notifications.
 */
export class Phase18PushAndWhatsApp1710000027000 implements MigrationInterface {
  name = 'Phase18PushAndWhatsApp1710000027000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "push_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "token" varchar(512) NOT NULL,
        "platform" varchar(16) NOT NULL DEFAULT 'web',
        "lastSeenAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_push_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_push_tokens_token" UNIQUE ("token")
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_push_tokens_user" ON "push_tokens" ("userId");
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "whatsappOptIn" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "whatsappOptInAt" timestamptz;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "whatsappOptIn",
        DROP COLUMN IF EXISTS "whatsappOptInAt";
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_push_tokens_user";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "push_tokens";`);
  }
}
