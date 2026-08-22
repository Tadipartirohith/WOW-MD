import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The configuration-driven service catalog.
 *
 * Five tables that between them replace what would otherwise be a module per
 * vendor type. A new trade — a mehendi artist, a drone crew, a horse for the
 * baraat — becomes rows an administrator writes rather than code somebody
 * ships.
 *
 * Additive throughout: `vendors` keeps its `category` enum and flat pricing, so
 * every existing listing, booking and quotation keeps loading while businesses
 * move onto the catalog at their own pace.
 */
export class Phase12ServiceCatalog1710000013000 implements MigrationInterface {
  name = 'Phase12ServiceCatalog1710000013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "service_attribute_type_enum" AS ENUM (
        'text','number','decimal','boolean','single_select','multi_select','date','time',
        'date_time','duration','currency','file','url','location','range'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "pricing_model_enum" AS ENUM (
        'fixed','per_person','per_hour','per_day','per_session','per_item',
        'starting_from','custom_quote','no_public_price'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "availability_model_enum" AS ENUM ('slot','full_day','multi_day','always')
    `);
    await queryRunner.query(`
      CREATE TYPE "attribute_scope_enum" AS ENUM ('service','booking')
    `);

    // ------------------------------------------------------------ categories

    await queryRunner.query(`
      CREATE TABLE "service_categories" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "slug" character varying(60) NOT NULL,
        "name" character varying(120) NOT NULL,
        "description" text,
        "icon" character varying(60),
        "active" boolean NOT NULL DEFAULT true,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_service_categories_slug" ON "service_categories" ("slug")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_categories_active" ON "service_categories" ("active")`,
    );

    // ----------------------------------------------------------- definitions

    await queryRunner.query(`
      CREATE TABLE "service_definitions" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "categoryId" uuid NOT NULL,
        "slug" character varying(60) NOT NULL,
        "name" character varying(140) NOT NULL,
        "description" text,
        "allowedPricingModels" jsonb NOT NULL DEFAULT '[]',
        "availabilityModel" "availability_model_enum" NOT NULL DEFAULT 'slot',
        "packagesAllowed" boolean NOT NULL DEFAULT true,
        "defaultCapacity" integer NOT NULL DEFAULT 1,
        "active" boolean NOT NULL DEFAULT true,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "FK_service_definitions_category"
          FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_service_definitions_category" ON "service_definitions" ("categoryId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_definitions_active" ON "service_definitions" ("active")`,
    );
    // One slug per category, not platform-wide: "full-day" means something
    // different under Photography than under Venue, and both should be able to
    // use the obvious word.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_service_definitions_category_slug"
       ON "service_definitions" ("categoryId", "slug")`,
    );

    // ------------------------------------------------------------ attributes

    await queryRunner.query(`
      CREATE TABLE "service_attributes" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "definitionId" uuid NOT NULL,
        "scope" "attribute_scope_enum" NOT NULL,
        "key" character varying(60) NOT NULL,
        "label" character varying(140) NOT NULL,
        "helpText" text,
        "type" "service_attribute_type_enum" NOT NULL,
        "required" boolean NOT NULL DEFAULT false,
        "constraints" jsonb NOT NULL DEFAULT '{}',
        "filterable" boolean NOT NULL DEFAULT false,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "FK_service_attributes_definition"
          FOREIGN KEY ("definitionId") REFERENCES "service_definitions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_service_attributes_definition" ON "service_attributes" ("definitionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_attributes_scope" ON "service_attributes" ("scope")`,
    );
    // A key is unique per scope, so the same word can be asked of the vendor
    // and of the buyer without one overwriting the other — "coverage_hours" is
    // both what the vendor offers and what the buyer wants.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_service_attributes_definition_scope_key"
       ON "service_attributes" ("definitionId", "scope", "key")`,
    );

    // -------------------------------------------------------- vendor services

    await queryRunner.query(`
      CREATE TABLE "vendor_services" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "vendorId" uuid NOT NULL,
        "definitionId" uuid NOT NULL,
        "displayName" character varying(140),
        "description" text,
        "attributes" jsonb NOT NULL DEFAULT '{}',
        "concurrentCapacity" integer NOT NULL DEFAULT 1,
        "active" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "FK_vendor_services_vendor"
          FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_vendor_services_definition"
          FOREIGN KEY ("definitionId") REFERENCES "service_definitions"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_vendor_services_vendor" ON "vendor_services" ("vendorId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vendor_services_definition" ON "vendor_services" ("definitionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vendor_services_active" ON "vendor_services" ("active")`,
    );
    // One business offers a given service once. Two rows for "candid
    // photography" is a duplicate listing, not two products — the products are
    // the offerings underneath.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_vendor_services_vendor_definition"
       ON "vendor_services" ("vendorId", "definitionId")`,
    );
    // Answers are queried by containment when a filterable attribute is
    // searched on, which is what GIN is for.
    await queryRunner.query(
      `CREATE INDEX "IDX_vendor_services_attributes" ON "vendor_services" USING GIN ("attributes")`,
    );

    // -------------------------------------------------------------- offerings

    await queryRunner.query(`
      CREATE TABLE "service_offerings" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "vendorServiceId" uuid NOT NULL,
        "name" character varying(140) NOT NULL,
        "description" text,
        "pricingModel" "pricing_model_enum" NOT NULL,
        "price" numeric(12,2),
        "currency" character varying NOT NULL DEFAULT 'INR',
        "unitLabel" character varying(40),
        "minQuantity" integer,
        "maxQuantity" integer,
        "isPackage" boolean NOT NULL DEFAULT false,
        "inclusions" jsonb NOT NULL DEFAULT '[]',
        "active" boolean NOT NULL DEFAULT true,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "FK_service_offerings_vendor_service"
          FOREIGN KEY ("vendorServiceId") REFERENCES "vendor_services"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_service_offerings_service" ON "service_offerings" ("vendorServiceId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_service_offerings_active" ON "service_offerings" ("active")`,
    );
    // Custom Quote and No Public Price carry no amount by definition; every
    // other model must. Enforced here as well as in the service, because a
    // priced offering with a null price is unrenderable and the database is
    // the one place that cannot be bypassed.
    await queryRunner.query(`
      ALTER TABLE "service_offerings"
      ADD CONSTRAINT "CHK_service_offerings_price_matches_model" CHECK (
        ("pricingModel" IN ('custom_quote','no_public_price') AND "price" IS NULL)
        OR ("pricingModel" NOT IN ('custom_quote','no_public_price') AND "price" IS NOT NULL)
      )
    `);

    // ---------------------------------------------------------- booking links
    //
    // Nullable, because bookings made before the catalog existed have no
    // service to point at and must keep loading. New vendor requests carry all
    // three: which service, which price, and the answers to that service's
    // booking form.

    await queryRunner.query(`
      ALTER TABLE "bookings"
      ADD COLUMN IF NOT EXISTS "vendorServiceId" uuid,
      ADD COLUMN IF NOT EXISTS "offeringId" uuid,
      ADD COLUMN IF NOT EXISTS "serviceAnswers" jsonb NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS "quantity" integer
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_bookings_vendor_service" ON "bookings" ("vendorServiceId")`,
    );
    await queryRunner.query(`
      ALTER TABLE "bookings"
      ADD CONSTRAINT "FK_bookings_vendor_service"
        FOREIGN KEY ("vendorServiceId") REFERENCES "vendor_services"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "bookings"
      ADD CONSTRAINT "FK_bookings_offering"
        FOREIGN KEY ("offeringId") REFERENCES "service_offerings"("id") ON DELETE SET NULL
    `);

    // -------------------------------------------------------- slot ownership
    //
    // A published window belongs to a service, once the vendor has one. That
    // is what lets a caterer publish 12:00–16:00 with capacity five for
    // catering and capacity one for their tasting service on the same day.

    await queryRunner.query(`
      ALTER TABLE "vendor_availability_slots"
      ADD COLUMN IF NOT EXISTS "vendorServiceId" uuid
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_slots_vendor_service" ON "vendor_availability_slots" ("vendorServiceId")`,
    );
    await queryRunner.query(`
      ALTER TABLE "vendor_availability_slots"
      ADD CONSTRAINT "FK_slots_vendor_service"
        FOREIGN KEY ("vendorServiceId") REFERENCES "vendor_services"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vendor_availability_slots" DROP CONSTRAINT IF EXISTS "FK_slots_vendor_service"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_slots_vendor_service"`);
    await queryRunner.query(
      `ALTER TABLE "vendor_availability_slots" DROP COLUMN IF EXISTS "vendorServiceId"`,
    );

    await queryRunner.query(`ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "FK_bookings_offering"`);
    await queryRunner.query(
      `ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "FK_bookings_vendor_service"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_bookings_vendor_service"`);
    await queryRunner.query(`
      ALTER TABLE "bookings"
      DROP COLUMN IF EXISTS "quantity",
      DROP COLUMN IF EXISTS "serviceAnswers",
      DROP COLUMN IF EXISTS "offeringId",
      DROP COLUMN IF EXISTS "vendorServiceId"
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "service_offerings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vendor_services"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_attributes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_definitions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_categories"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "attribute_scope_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "availability_model_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "pricing_model_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "service_attribute_type_enum"`);
  }
}
