import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The service catalogue an administrator actually browses (EZ1-I220).
 *
 * The categories existed and held one service each, so opening Photography in
 * Services & Catalog showed a single row and told a vendor nothing about what
 * they could list. The six categories named in the report are seeded here with
 * the services under them, in the database rather than the frontend, so an
 * administrator can add, rename or retire without a deployment.
 *
 * Reconciled against what was already there rather than added beside it:
 *
 *   Beauty        -> the existing `makeup` row, renamed. It held no vendor
 *                    services, and Mehendi is one of the services listed under
 *                    Beauty in the report, so the two are the same category.
 *   Decorations   -> the existing `decor` row ("Decoration & Florals"),
 *                    renamed, with the florals half splitting out below.
 *   Flower Decors -> new.
 *   Cooking       -> new.
 *   Catering      -> the existing row, unchanged.
 *   Photography   -> the existing row, name left as "Photography &
 *                    Videography": it carries 44 live vendor services and
 *                    renaming a category vendors already sell under buys
 *                    nothing.
 *
 * Every write is idempotent — categories key on `slug`, services on
 * `(categoryId, slug)`, both of which carry unique indexes — so re-running
 * this, or running it against a portal where an administrator has already
 * added some of these by hand, changes nothing and loses nothing. Existing
 * services, vendor listings and bookings are untouched.
 */
export class Phase48SeedServiceCatalog1710000073000 implements MigrationInterface {
  name = 'Phase48SeedServiceCatalog1710000073000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The two unused categories whose names the report supersedes.
    await queryRunner.query(
      `UPDATE "service_categories" SET "name" = 'Beauty' WHERE "slug" = 'makeup'`,
    );
    await queryRunner.query(
      `UPDATE "service_categories" SET "name" = 'Decorations' WHERE "slug" = 'decor'`,
    );

    const categories: { slug: string; name: string; sort: number }[] = [
      { slug: 'makeup', name: 'Beauty', sort: 10 },
      { slug: 'catering', name: 'Catering', sort: 20 },
      { slug: 'cooking', name: 'Cooking', sort: 30 },
      { slug: 'decor', name: 'Decorations', sort: 40 },
      { slug: 'flower-decors', name: 'Flower Decors', sort: 50 },
      { slug: 'photography', name: 'Photography & Videography', sort: 60 },
    ];

    for (const c of categories) {
      await queryRunner.query(
        `INSERT INTO "service_categories" ("slug", "name", "sortOrder")
         VALUES ($1, $2, $3)
         ON CONFLICT ("slug") DO NOTHING`,
        [c.slug, c.name, c.sort],
      );
    }

    /*
     * Pricing models per category, chosen to match how the work is actually
     * sold: a caterer quotes per head, a photographer per day or per job, a
     * decorator against the room. `starting_from` is on everything because a
     * listing with no indicative price is one nobody enquires about.
     */
    const PER_PERSON = ['per_person', 'starting_from', 'custom_quote'];
    const PER_JOB = ['fixed', 'per_day', 'starting_from'];
    const PER_EVENT = ['fixed', 'starting_from', 'custom_quote'];

    const services: Record<string, { pricing: string[]; items: [string, string][] }> = {
      makeup: {
        pricing: PER_JOB,
        items: [
          ['bridal-makeup', 'Bridal Makeup'],
          ['groom-makeup', 'Groom Makeup'],
          ['engagement-makeup', 'Engagement Makeup'],
          ['reception-makeup', 'Reception Makeup'],
          ['hair-styling', 'Hair Styling'],
          ['saree-draping', 'Saree Draping'],
          ['mehendi', 'Mehendi'],
          ['nail-art', 'Nail Art'],
        ],
      },
      catering: {
        pricing: PER_PERSON,
        items: [
          ['wedding-catering', 'Wedding Catering'],
          ['reception-catering', 'Reception Catering'],
          ['engagement-catering', 'Engagement Catering'],
          ['buffet-catering', 'Buffet Catering'],
          ['plated-catering', 'Plated Catering'],
          ['live-food-counters', 'Live Food Counters'],
          ['desserts-sweets', 'Desserts & Sweets'],
          ['beverage-services', 'Beverage Services'],
        ],
      },
      cooking: {
        pricing: PER_PERSON,
        items: [
          ['traditional-indian', 'Traditional Indian Cuisine'],
          ['north-indian', 'North Indian Cuisine'],
          ['south-indian', 'South Indian Cuisine'],
          ['chinese', 'Chinese Cuisine'],
          ['continental', 'Continental Cuisine'],
          ['regional', 'Regional Cuisine'],
          ['vegetarian-menu', 'Vegetarian Menu'],
          ['non-vegetarian-menu', 'Non-Vegetarian Menu'],
        ],
      },
      decor: {
        pricing: PER_EVENT,
        items: [
          ['wedding-decoration', 'Wedding Decoration'],
          ['reception-decoration', 'Reception Decoration'],
          ['engagement-decoration', 'Engagement Decoration'],
          ['mandap-decoration', 'Mandap Decoration'],
          ['stage-decoration', 'Stage Decoration'],
          ['venue-decoration', 'Venue Decoration'],
          ['entrance-decoration', 'Entrance Decoration'],
          ['theme-decoration', 'Theme Decoration'],
        ],
      },
      'flower-decors': {
        pricing: PER_EVENT,
        items: [
          ['mandap-flowers', 'Mandap Flower Decoration'],
          ['stage-flowers', 'Stage Flower Decoration'],
          ['entrance-flowers', 'Entrance Flower Decoration'],
          ['table-flowers', 'Table Flower Decoration'],
          ['floral-backdrop', 'Floral Backdrop'],
          ['bridal-bouquet', 'Bridal Bouquet'],
          ['floral-garlands', 'Floral Garlands'],
          ['car-flowers', 'Car Flower Decoration'],
        ],
      },
      photography: {
        pricing: PER_JOB,
        items: [
          ['pre-wedding-shoot', 'Pre-Wedding Shoot'],
          ['wedding-shoot', 'Wedding Shoot'],
          ['candid-photography-std', 'Candid Photography'],
          ['traditional-photography', 'Traditional Photography'],
          ['reception-photography', 'Reception Photography'],
          ['engagement-photography', 'Engagement Photography'],
          ['drone-photography', 'Drone Photography'],
          ['wedding-photo-album', 'Wedding Photo Album'],
        ],
      },
    };

    for (const [categorySlug, group] of Object.entries(services)) {
      let sort = 0;
      for (const [slug, name] of group.items) {
        sort += 10;
        await queryRunner.query(
          `INSERT INTO "service_definitions"
             ("categoryId", "slug", "name", "allowedPricingModels", "sortOrder")
           SELECT c."id", $2, $3, $4::jsonb, $5
           FROM "service_categories" c
           WHERE c."slug" = $1
           ON CONFLICT ("categoryId", "slug") DO NOTHING`,
          [categorySlug, slug, name, JSON.stringify(group.pricing), sort],
        );
      }
    }
  }

  /**
   * Removes only what this migration added, and only while nothing sells it.
   *
   * A vendor may have listed one of these services since; deleting the
   * definition out from under a live listing would break their catalogue, so
   * anything in use is left alone. The two renames are put back.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const slugs = [
      'bridal-makeup', 'groom-makeup', 'engagement-makeup', 'reception-makeup',
      'hair-styling', 'saree-draping', 'mehendi', 'nail-art',
      'wedding-catering', 'reception-catering', 'engagement-catering', 'buffet-catering',
      'plated-catering', 'live-food-counters', 'desserts-sweets', 'beverage-services',
      'traditional-indian', 'north-indian', 'south-indian', 'chinese',
      'continental', 'regional', 'vegetarian-menu', 'non-vegetarian-menu',
      'wedding-decoration', 'reception-decoration', 'engagement-decoration', 'mandap-decoration',
      'stage-decoration', 'venue-decoration', 'entrance-decoration', 'theme-decoration',
      'mandap-flowers', 'stage-flowers', 'entrance-flowers', 'table-flowers',
      'floral-backdrop', 'bridal-bouquet', 'floral-garlands', 'car-flowers',
      'pre-wedding-shoot', 'wedding-shoot', 'candid-photography-std', 'traditional-photography',
      'reception-photography', 'engagement-photography', 'drone-photography', 'wedding-photo-album',
    ];
    await queryRunner.query(
      `DELETE FROM "service_definitions"
       WHERE "slug" = ANY($1)
         AND "id" NOT IN (SELECT "definitionId" FROM "vendor_services")`,
      [slugs],
    );
    await queryRunner.query(
      `DELETE FROM "service_categories"
       WHERE "slug" IN ('cooking', 'flower-decors')
         AND "id" NOT IN (SELECT "categoryId" FROM "service_definitions")`,
    );
    await queryRunner.query(
      `UPDATE "service_categories" SET "name" = 'Makeup & Mehendi' WHERE "slug" = 'makeup'`,
    );
    await queryRunner.query(
      `UPDATE "service_categories" SET "name" = 'Decoration & Florals' WHERE "slug" = 'decor'`,
    );
  }
}
