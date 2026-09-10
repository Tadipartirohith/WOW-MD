import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The rest of the wedding vendor catalogue (EZ1-I239).
 *
 * EZ1-I220 seeded six categories the reporter listed by name. Five of the
 * categories that already existed were left holding a single service each --
 * Venues, Entertainment, Transportation, Priests & Rituals and Wedding
 * Planning -- so an admin opening any of them saw one row, and a vendor in
 * those trades had almost nothing to list against.
 *
 * A note on scope: this issue's description is a copy of EZ1-I224's (the Total
 * Users count) and names no services, so the tree below is chosen from the
 * trades a wedding marketplace in this market actually books rather than from
 * the ticket. It is the obvious reading of the title, and it is easy to amend
 * -- an administrator can add, rename or retire any of it without a
 * deployment, which is the whole point of the catalogue living in the database.
 *
 * Idempotent on the same unique indexes EZ1-I220 used: categories key on
 * `slug`, services on `(categoryId, slug)`. Re-running changes nothing, and
 * nothing already listed by a vendor is touched.
 */
export class Phase51SeedFullVendorCatalog1710000076000 implements MigrationInterface {
  name = 'Phase51SeedFullVendorCatalog1710000076000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const PER_JOB = ['fixed', 'per_day', 'starting_from'];
    const PER_EVENT = ['fixed', 'starting_from', 'custom_quote'];
    const PER_PERSON = ['per_person', 'starting_from', 'custom_quote'];

    // Categories that need creating. The five thin ones already exist and are
    // only extended below.
    const newCategories: { slug: string; name: string; sort: number }[] = [
      { slug: 'attire', name: 'Bridal Wear & Jewellery', sort: 70 },
      { slug: 'invitations', name: 'Invitations & Stationery', sort: 80 },
      { slug: 'lighting-sound', name: 'Lighting & Sound', sort: 90 },
      { slug: 'rentals', name: 'Tent, Furniture & Rentals', sort: 100 },
      { slug: 'cakes', name: 'Cakes & Confectionery', sort: 110 },
      { slug: 'gifts', name: 'Gifts & Favours', sort: 120 },
    ];
    for (const c of newCategories) {
      await queryRunner.query(
        `INSERT INTO "service_categories" ("slug", "name", "sortOrder")
         VALUES ($1, $2, $3)
         ON CONFLICT ("slug") DO NOTHING`,
        [c.slug, c.name, c.sort],
      );
    }

    const services: Record<string, { pricing: string[]; items: [string, string][] }> = {
      venue: {
        pricing: PER_EVENT,
        items: [
          ['banquet-hall', 'Banquet Hall'],
          ['marriage-garden', 'Marriage Garden / Lawn'],
          ['resort-wedding', 'Resort Wedding'],
          ['heritage-venue', 'Heritage & Palace Venue'],
          ['rooftop-venue', 'Rooftop Venue'],
          ['temple-wedding', 'Temple Wedding'],
          ['destination-venue', 'Destination Venue'],
          ['reception-venue', 'Reception Venue'],
        ],
      },
      entertainment: {
        pricing: PER_JOB,
        items: [
          ['dj', 'DJ'],
          ['live-band', 'Live Band'],
          ['dhol-players', 'Dhol Players'],
          ['classical-musicians', 'Classical Musicians'],
          ['anchor-emcee', 'Anchor / Emcee'],
          ['choreographer', 'Sangeet Choreographer'],
          ['dance-troupe', 'Dance Troupe'],
          ['fireworks', 'Fireworks & Cold Pyro'],
        ],
      },
      transportation: {
        pricing: PER_JOB,
        items: [
          ['bridal-car', 'Decorated Bridal Car'],
          ['vintage-car', 'Vintage Car'],
          ['guest-coach', 'Guest Coach / Bus'],
          ['luxury-fleet', 'Luxury Car Fleet'],
          ['horse-baraat', 'Horse for Baraat'],
          ['palki-doli', 'Palki / Doli'],
          ['airport-transfers', 'Airport Transfers'],
          ['valet-parking', 'Valet Parking'],
        ],
      },
      priest: {
        pricing: PER_EVENT,
        items: [
          ['wedding-pandit', 'Wedding Pandit'],
          ['engagement-rituals', 'Engagement Rituals'],
          ['haldi-rituals', 'Haldi & Mehendi Rituals'],
          ['griha-pravesh', 'Griha Pravesh'],
          ['nikah-services', 'Nikah Services'],
          ['christian-officiant', 'Christian Officiant'],
          ['havan-puja', 'Havan & Puja'],
          ['astrology-matching', 'Horoscope Matching'],
        ],
      },
      planning: {
        pricing: PER_EVENT,
        items: [
          ['full-planning', 'Full Wedding Planning'],
          ['day-coordination', 'Day-of Coordination'],
          ['destination-planning', 'Destination Wedding Planning'],
          ['guest-management', 'Guest Management'],
          ['vendor-management', 'Vendor Management'],
          ['budget-planning', 'Budget Planning'],
          ['theme-design', 'Theme & Design'],
          ['hospitality-desk', 'Hospitality Desk'],
        ],
      },
      attire: {
        pricing: PER_JOB,
        items: [
          ['bridal-lehenga', 'Bridal Lehenga'],
          ['bridal-saree', 'Bridal Saree'],
          ['groom-sherwani', 'Groom Sherwani'],
          ['trousseau-styling', 'Trousseau Styling'],
          ['bridal-jewellery', 'Bridal Jewellery'],
          ['jewellery-rental', 'Jewellery on Rent'],
          ['footwear', 'Wedding Footwear'],
          ['turban-safa', 'Turban & Safa'],
        ],
      },
      invitations: {
        pricing: PER_JOB,
        items: [
          ['printed-cards', 'Printed Invitation Cards'],
          ['digital-invites', 'Digital Invitations'],
          ['invitation-video', 'Invitation Video'],
          ['wedding-website', 'Wedding Website'],
          ['calligraphy', 'Calligraphy & Envelopes'],
          ['welcome-signage', 'Welcome Signage'],
          ['menu-cards', 'Menu & Place Cards'],
          ['thank-you-cards', 'Thank You Cards'],
        ],
      },
      'lighting-sound': {
        pricing: PER_EVENT,
        items: [
          ['stage-lighting', 'Stage Lighting'],
          ['ambient-lighting', 'Ambient & Fairy Lighting'],
          ['facade-lighting', 'Facade Lighting'],
          ['sound-system', 'Sound System'],
          ['led-screens', 'LED Screens'],
          ['live-streaming', 'Live Streaming'],
          ['special-effects', 'Special Effects'],
          ['generator-backup', 'Generator & Power Backup'],
        ],
      },
      rentals: {
        pricing: PER_EVENT,
        items: [
          ['tent-shamiana', 'Tent & Shamiana'],
          ['furniture-rental', 'Furniture Rental'],
          ['crockery-rental', 'Crockery & Cutlery'],
          ['mandap-structure', 'Mandap Structure'],
          ['seating-arrangement', 'Seating Arrangement'],
          ['air-cooling', 'Air Cooling & Heating'],
          ['portable-washrooms', 'Portable Washrooms'],
          ['flooring-carpeting', 'Flooring & Carpeting'],
        ],
      },
      cakes: {
        pricing: PER_JOB,
        items: [
          ['wedding-cake', 'Wedding Cake'],
          ['engagement-cake', 'Engagement Cake'],
          ['cupcake-tower', 'Cupcake Tower'],
          ['dessert-table', 'Dessert Table'],
          ['chocolate-fountain', 'Chocolate Fountain'],
          ['eggless-cakes', 'Eggless Cakes'],
          ['themed-cakes', 'Themed Cakes'],
          ['favour-boxes', 'Cake Favour Boxes'],
        ],
      },
      gifts: {
        pricing: PER_PERSON,
        items: [
          ['guest-favours', 'Guest Favours'],
          ['welcome-hampers', 'Welcome Hampers'],
          ['trousseau-packing', 'Trousseau Packing'],
          ['return-gifts', 'Return Gifts'],
          ['personalised-gifts', 'Personalised Gifts'],
          ['dry-fruit-boxes', 'Dry Fruit Boxes'],
          ['sweet-boxes', 'Sweet Boxes'],
          ['gift-wrapping', 'Gift Wrapping'],
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
   * Removes only what this added, and only while nothing sells it.
   *
   * A vendor may have listed one of these since; deleting a definition out from
   * under a live listing would break their catalogue, so anything in use stays.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "service_definitions" d
       USING "service_categories" c
       WHERE d."categoryId" = c."id"
         AND c."slug" IN ('venue','entertainment','transportation','priest','planning',
                          'attire','invitations','lighting-sound','rentals','cakes','gifts')
         AND d."sortOrder" > 0
         AND d."id" NOT IN (SELECT "definitionId" FROM "vendor_services")`,
    );
    await queryRunner.query(
      `DELETE FROM "service_categories"
       WHERE "slug" IN ('attire','invitations','lighting-sound','rentals','cakes','gifts')
         AND "id" NOT IN (SELECT "categoryId" FROM "service_definitions")`,
    );
  }
}
