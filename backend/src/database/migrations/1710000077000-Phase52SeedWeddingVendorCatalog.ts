import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The full wedding vendor catalogue (EZ1-I239).
 *
 * The report lists thirty-five vendor categories and the services under each,
 * covering the whole arc of a wedding from planning through the honeymoon.
 * They are seeded here, in the database rather than the frontend, so an
 * administrator keeps the Add / Edit / Retire controls the report insists on
 * and never needs a deployment to change the tree.
 *
 * Sixteen of the thirty-five already existed under their own slugs and are
 * extended and renamed to the report's names rather than duplicated -- slugs
 * are left alone because vendor listings key on them. `cooking`, which the
 * report does not mention, is left exactly as it is.
 *
 * This also reconciles the interim catalogue added by Phase51: that seeded a
 * smaller tree chosen from the trades, because the services this ticket asks
 * for sit a long way down the description and were missed on the first read.
 * Where a Phase51 guess is superseded by a named service here, the guess is
 * removed -- but only when no vendor has listed it, because the report is
 * explicit that anything a vendor sells is retired, never deleted.
 *
 * Idempotent throughout: categories key on `slug`, services on
 * `(categoryId, slug)`, both unique. Re-running changes nothing, and an
 * administrator's own additions and retirements survive it.
 */
export class Phase52SeedWeddingVendorCatalog1710000077000 implements MigrationInterface {
  name = 'Phase52SeedWeddingVendorCatalog1710000077000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * Pricing models per category, matching how each trade actually sells: a
     * caterer quotes per head, a photographer per day or per job, a decorator
     * against the room. `starting_from` is on everything because a listing
     * with no indicative price is one nobody enquires about.
     */
    const PER_PERSON = ['per_person', 'starting_from', 'custom_quote'];
    const PER_JOB = ['fixed', 'per_day', 'starting_from'];
    const PER_EVENT = ['fixed', 'starting_from', 'custom_quote'];

    /**
     * The catalogue. `slug` is the stable key -- the sixteen categories that
     * already exist keep the slug they were created with, whatever the report
     * calls them now, so no vendor listing is orphaned.
     */
    const CATALOG: { slug: string; name: string; pricing: string[]; services: string[] }[] = [
      {
        slug: 'planning',
        name: 'Wedding Planner',
        pricing: PER_EVENT,
        services: [
          'Full Wedding Planning', 'Partial Wedding Planning', 'Day-of Wedding Coordination',
          'Destination Wedding Planning', 'Budget Planning', 'Vendor Coordination',
          'Wedding Timeline Planning', 'Guest Management', 'Wedding Design & Concept Planning',
          'Ceremony Planning', 'Reception Planning', 'Sangeet Planning',
          'Mehendi Ceremony Planning', 'Wedding Logistics Management',
        ],
      },
      {
        slug: 'venue',
        name: 'Wedding Venue',
        pricing: PER_EVENT,
        services: [
          'Banquet Hall', 'Wedding Resort', 'Hotel Wedding Venue', 'Outdoor Wedding Venue',
          'Garden Venue', 'Beach Wedding Venue', 'Farmhouse Venue', 'Palace / Heritage Venue',
          'Temple Wedding Venue', 'Rooftop Venue', 'Destination Wedding Venue',
          'Pre-Wedding Event Venue', 'Reception Venue',
        ],
      },
      {
        slug: 'catering',
        name: 'Catering',
        pricing: PER_PERSON,
        services: [
          'Wedding Catering', 'Reception Catering', 'Engagement Catering', 'Mehendi Catering',
          'Sangeet Catering', 'Buffet Catering', 'Plated Catering', 'Vegetarian Catering',
          'Non-Vegetarian Catering', 'Jain Catering', 'Regional Cuisine', 'North Indian Cuisine',
          'South Indian Cuisine', 'Chinese Cuisine', 'Continental Cuisine', 'Live Food Counters',
          'Chaat Counter', 'Dessert Counter', 'Beverage Counter', 'Tea & Coffee Service',
          'Custom Menu Catering',
        ],
      },
      {
        slug: 'decor',
        name: 'Wedding Decorator',
        pricing: PER_EVENT,
        services: [
          'Wedding Decoration', 'Reception Decoration', 'Engagement Decoration',
          'Mehendi Decoration', 'Sangeet Decoration', 'Theme Decoration', 'Venue Decoration',
          'Entrance Decoration', 'Stage Decoration', 'Table Decoration', 'Ceiling Decoration',
          'Mandap Decoration', 'Floral Decoration', 'Draping Decoration',
          'Traditional Decoration', 'Modern Decoration', 'Custom Wedding Decor',
        ],
      },
      {
        slug: 'photography',
        name: 'Wedding Photographer',
        pricing: PER_JOB,
        services: [
          'Traditional Wedding Photography', 'Candid Wedding Photography',
          'Pre-Wedding Photography', 'Engagement Photography', 'Mehendi Photography',
          'Sangeet Photography', 'Reception Photography', 'Bridal Photography',
          'Groom Photography', 'Family Photography', 'Couple Portraits', 'Wedding Album',
          'Premium Wedding Album', 'Same-Day Photo Delivery',
        ],
      },
      {
        slug: 'videography',
        name: 'Wedding Videographer',
        pricing: PER_JOB,
        services: [
          'Traditional Wedding Videography', 'Cinematic Wedding Video', 'Pre-Wedding Video',
          'Engagement Video', 'Mehendi Video', 'Sangeet Video', 'Reception Video',
          'Wedding Highlights Video', 'Full Wedding Documentary', 'Same-Day Edit',
          'Wedding Trailer', 'Family Interview Video', 'Live Wedding Streaming',
        ],
      },
      {
        slug: 'makeup',
        name: 'Makeup Artist',
        pricing: PER_JOB,
        services: [
          'Bridal Makeup', 'Groom Makeup', 'Engagement Makeup', 'Reception Makeup',
          'Mehendi Makeup', 'Sangeet Makeup', 'HD Makeup', 'Airbrush Makeup',
          'Traditional Makeup', 'Natural Makeup', 'Party Makeup', 'Family Makeup',
          'Makeup Trial',
        ],
      },
      {
        slug: 'hair-stylist',
        name: 'Hair Stylist',
        pricing: PER_JOB,
        services: [
          'Bridal Hair Styling', 'Groom Hair Styling', 'Engagement Hairstyle',
          'Reception Hairstyle', 'Mehendi Hairstyle', 'Sangeet Hairstyle',
          'Traditional Hairstyle', 'Modern Hairstyle', 'Hair Extensions',
          'Hair Accessories Styling', 'Hair Trial',
        ],
      },
      {
        slug: 'mehendi-artist',
        name: 'Mehendi Artist',
        pricing: PER_JOB,
        services: [
          'Bridal Mehendi', 'Arabic Mehendi', 'Traditional Mehendi', 'Modern Mehendi',
          'Minimal Mehendi', 'Engagement Mehendi', 'Guest Mehendi', 'Family Mehendi',
          'Feet Mehendi', 'Custom Mehendi Design',
        ],
      },
      {
        slug: 'attire',
        name: 'Bridal Wear',
        pricing: PER_JOB,
        services: [
          'Bridal Lehenga', 'Bridal Saree', 'Bridal Gown', 'Reception Dress',
          'Engagement Dress', 'Mehendi Outfit', 'Sangeet Outfit', 'Bridal Accessories',
          'Bridal Veil', 'Bridal Dupatta', 'Wedding Footwear', 'Bridal Outfit Rental',
          'Custom Bridal Wear',
        ],
      },
      {
        slug: 'groom-wear',
        name: 'Groom Wear',
        pricing: PER_JOB,
        services: [
          'Sherwani', 'Indo-Western', 'Wedding Suit', 'Tuxedo', 'Kurta Pajama',
          'Reception Outfit', 'Engagement Outfit', 'Sangeet Outfit', 'Groom Accessories',
          'Safa / Turban', 'Groom Footwear', 'Groom Outfit Rental', 'Custom Groom Wear',
        ],
      },
      {
        slug: 'jewellery',
        name: 'Jewellery',
        pricing: PER_JOB,
        services: [
          'Bridal Jewellery', 'Gold Jewellery', 'Diamond Jewellery', 'Temple Jewellery',
          'Kundan Jewellery', 'Polki Jewellery', 'Jadau Jewellery', 'Artificial Jewellery',
          'Jewellery Rental', 'Necklace Sets', 'Bridal Bangles', 'Earrings', 'Maang Tikka',
          'Nose Ring', 'Groom Jewellery',
        ],
      },
      {
        slug: 'invitations',
        name: 'Wedding Invitations',
        pricing: PER_JOB,
        services: [
          'Traditional Invitations', 'Luxury Invitations', 'Printed Invitations',
          'Custom Invitations', 'Box Invitations', 'Scroll Invitations',
          'Eco-Friendly Invitations', 'Digital Invitations', 'RSVP Cards',
          'Save-the-Date Cards', 'Thank You Cards',
        ],
      },
      {
        slug: 'cakes',
        name: 'Wedding Cake',
        pricing: PER_JOB,
        services: [
          'Wedding Cake', 'Engagement Cake', 'Reception Cake', 'Custom Theme Cake',
          'Multi-Tier Cake', 'Designer Cake', 'Photo Cake', 'Eggless Cake', 'Vegan Cake',
          'Cupcake Tower', 'Dessert Table',
        ],
      },
      {
        slug: 'flower-decors',
        name: 'Florist',
        pricing: PER_EVENT,
        services: [
          'Bridal Bouquet', 'Bridesmaid Bouquet', 'Groom Boutonniere', 'Wedding Garlands',
          'Floral Mandap', 'Floral Stage', 'Floral Entrance', 'Floral Backdrop',
          'Table Flowers', 'Car Flower Decoration', 'Venue Floral Decoration',
          'Custom Floral Arrangements',
        ],
      },
      {
        slug: 'dj-music',
        name: 'DJ / Music',
        pricing: PER_JOB,
        services: [
          'Wedding DJ', 'Reception DJ', 'Sangeet DJ', 'Mehendi DJ', 'Cocktail Party DJ',
          'Background Music', 'DJ + Sound System', 'Music Playlist Services',
          'Event Music Management',
        ],
      },
      {
        slug: 'live-band',
        name: 'Live Band / Singers',
        pricing: PER_JOB,
        services: [
          'Wedding Band', 'Live Singer', 'Bollywood Band', 'Classical Singer', 'Folk Music',
          'Instrumental Performance', 'Acoustic Band', 'Sufi Singer', 'Regional Music Band',
          'Live Music for Reception',
        ],
      },
      {
        slug: 'sangeet-choreographer',
        name: 'Sangeet Choreographer',
        pricing: PER_JOB,
        services: [
          'Couple Dance', 'Family Dance', 'Friends Dance', 'Bridesmaids Dance',
          'Groom Squad Dance', 'Sangeet Group Choreography', 'Couple Dance Training',
          'Family Dance Training', 'Performance Planning', 'Sangeet Show Direction',
        ],
      },
      {
        slug: 'wedding-anchor',
        name: 'Wedding Anchor / MC',
        pricing: PER_JOB,
        services: [
          'Wedding Hosting', 'Reception Hosting', 'Sangeet Hosting', 'Engagement Hosting',
          'Mehendi Hosting', 'Games & Activities', 'Couple Games', 'Guest Interaction',
          'Event Program Coordination',
        ],
      },
      {
        slug: 'priest',
        name: 'Priest / Pandit',
        pricing: PER_EVENT,
        services: [
          'Hindu Wedding Ceremony', 'Engagement Ceremony', 'Ganesh Puja', 'Haldi Ceremony',
          'Mehendi Ceremony', 'Sangeet Ceremony', 'Pheras', 'Muhurat Consultation',
          'Traditional Rituals', 'Vedic Wedding Ceremony', 'Destination Wedding Ceremony',
        ],
      },
      {
        slug: 'transportation',
        name: 'Wedding Transportation',
        pricing: PER_JOB,
        services: [
          'Bridal Car', 'Groom Car', 'Luxury Car', 'Vintage Car', 'Wedding Bus',
          'Guest Transportation', 'Airport Transfers', 'Hotel Transfers', 'Event Shuttle',
          'Driver Services',
        ],
      },
      {
        slug: 'guest-accommodation',
        name: 'Guest Accommodation',
        pricing: PER_PERSON,
        services: [
          'Hotel Rooms', 'Resort Accommodation', 'Guest House', 'Villa Accommodation',
          'Destination Stay', 'Group Hotel Booking', 'Room Allocation',
          'Guest Check-in Management', 'Guest Stay Packages',
        ],
      },
      {
        slug: 'guest-hospitality',
        name: 'Guest Hospitality',
        pricing: PER_PERSON,
        services: [
          'Guest Welcome Desk', 'Guest Registration', 'Welcome Kits', 'Guest Coordination',
          'Hospitality Staff', 'Guest Transportation Coordination', 'Room Assistance',
          'VIP Guest Management', 'Guest Help Desk',
        ],
      },
      {
        slug: 'gifts',
        name: 'Wedding Gifts / Return Gifts',
        pricing: PER_PERSON,
        services: [
          'Return Gift Hampers', 'Personalized Gifts', 'Corporate Gifts', 'Traditional Gifts',
          'Gift Boxes', 'Wedding Gift Hampers', 'Guest Gift Bags', 'Customized Merchandise',
          'Premium Return Gifts',
        ],
      },
      {
        slug: 'rentals',
        name: 'Event Equipment Rental',
        pricing: PER_EVENT,
        services: [
          'Tables', 'Chairs', 'Sofa Seating', 'Tents', 'Canopies', 'Dining Equipment',
          'Crockery', 'Cutlery', 'Stage Equipment', 'Event Furniture', 'Event Accessories',
        ],
      },
      {
        slug: 'lighting-sound',
        name: 'Lighting & Sound',
        pricing: PER_EVENT,
        services: [
          'Wedding Lighting', 'Stage Lighting', 'Decorative Lighting', 'Fairy Lights',
          'LED Lighting', 'Sound System', 'Speaker Rental', 'Microphone Rental',
          'Amplifier Rental', 'Dance Floor Lighting', 'Professional AV Setup',
        ],
      },
      {
        slug: 'stage-mandap',
        name: 'Stage / Mandap Setup',
        pricing: PER_EVENT,
        services: [
          'Wedding Stage', 'Reception Stage', 'Engagement Stage', 'Traditional Mandap',
          'Modern Mandap', 'Floral Mandap', 'Customized Mandap', 'Stage Backdrop',
          'Stage Seating', 'Mandap Lighting',
        ],
      },
      {
        slug: 'entertainment',
        name: 'Entertainment / Performers',
        pricing: PER_JOB,
        services: [
          'Dancers', 'Folk Performers', 'Bollywood Performers', 'Classical Dancers',
          'Fire Performers', 'Magicians', 'Comedians', 'Celebrity Performers',
          'Cultural Performers', 'Puppet Shows', 'Kids Entertainment',
        ],
      },
      {
        slug: 'security-valet',
        name: 'Security / Valet / Parking',
        pricing: PER_EVENT,
        services: [
          'Event Security', 'VIP Security', 'Guest Security', 'Valet Parking',
          'Parking Management', 'Security Guards', 'Entry Management', 'Crowd Management',
          'Event Safety Management',
        ],
      },
      {
        slug: 'travel-agency',
        name: 'Travel Agency',
        pricing: PER_PERSON,
        services: [
          'Wedding Guest Travel', 'Domestic Travel', 'International Travel', 'Flight Booking',
          'Train Booking', 'Airport Transfers', 'Group Travel', 'Destination Wedding Travel',
          'Travel Packages', 'Travel Coordination',
        ],
      },
      {
        slug: 'honeymoon',
        name: 'Honeymoon Services',
        pricing: PER_PERSON,
        services: [
          'Honeymoon Packages', 'Domestic Honeymoon', 'International Honeymoon',
          'Honeymoon Hotels', 'Honeymoon Resorts', 'Flights & Transfers', 'Couple Activities',
          'Romantic Dinner Packages', 'Honeymoon Cruises', 'Customized Honeymoon Packages',
        ],
      },
      {
        slug: 'content-creator',
        name: 'Wedding Content Creator',
        pricing: PER_JOB,
        services: [
          'Wedding Reels', 'Instagram Reels', 'Behind-the-Scenes Content',
          'Same-Day Social Media Content', 'Wedding Stories', 'Short-Form Videos',
          'Couple Content', 'Guest Interviews', 'Social Media Management',
          'Live Social Media Coverage',
        ],
      },
      {
        slug: 'drone-photography',
        name: 'Drone Photography',
        pricing: PER_JOB,
        services: [
          'Wedding Drone Photography', 'Wedding Drone Videography', 'Venue Aerial Shots',
          'Couple Aerial Shots', 'Pre-Wedding Drone Shoot', 'Reception Drone Coverage',
          'Destination Wedding Drone Coverage', 'Cinematic Aerial Video',
        ],
      },
      {
        slug: 'photo-booth',
        name: 'Photo Booth',
        pricing: PER_EVENT,
        services: [
          'Traditional Photo Booth', '360 Photo Booth', 'Mirror Photo Booth', 'Selfie Booth',
          'GIF Booth', 'Slow Motion Booth', 'AI Photo Booth', 'Themed Photo Booth',
          'Instant Photo Printing',
        ],
      },
      {
        slug: 'digital-invitations',
        name: 'Digital Wedding Invitations / Wedding Website',
        pricing: PER_JOB,
        services: [
          'Digital Wedding Invitation', 'Animated Invitation', 'Video Invitation',
          'Wedding Website', 'RSVP Management', 'Digital Save-the-Date', 'Online Guest List',
          'Event Schedule', 'Venue & Map Integration', 'Gift Registry',
          'Digital Thank You Card',
        ],
      },
    ];

    /**
     * The interim tree Phase51 guessed at, by category. Anything here the
     * report does not name is removed below -- unless a vendor sells it.
     */
    const PHASE51: Record<string, string[]> = {
      venue: ['banquet-hall', 'marriage-garden', 'resort-wedding', 'heritage-venue',
        'rooftop-venue', 'temple-wedding', 'destination-venue', 'reception-venue'],
      entertainment: ['dj', 'live-band', 'dhol-players', 'classical-musicians', 'anchor-emcee',
        'choreographer', 'dance-troupe', 'fireworks'],
      transportation: ['bridal-car', 'vintage-car', 'guest-coach', 'luxury-fleet', 'horse-baraat',
        'palki-doli', 'airport-transfers', 'valet-parking'],
      priest: ['wedding-pandit', 'engagement-rituals', 'haldi-rituals', 'griha-pravesh',
        'nikah-services', 'christian-officiant', 'havan-puja', 'astrology-matching'],
      planning: ['full-planning', 'day-coordination', 'destination-planning', 'guest-management',
        'vendor-management', 'budget-planning', 'theme-design', 'hospitality-desk'],
      attire: ['bridal-lehenga', 'bridal-saree', 'groom-sherwani', 'trousseau-styling',
        'bridal-jewellery', 'jewellery-rental', 'footwear', 'turban-safa'],
      invitations: ['printed-cards', 'digital-invites', 'invitation-video', 'wedding-website',
        'calligraphy', 'welcome-signage', 'menu-cards', 'thank-you-cards'],
      'lighting-sound': ['stage-lighting', 'ambient-lighting', 'facade-lighting', 'sound-system',
        'led-screens', 'live-streaming', 'special-effects', 'generator-backup'],
      rentals: ['tent-shamiana', 'furniture-rental', 'crockery-rental', 'mandap-structure',
        'seating-arrangement', 'air-cooling', 'portable-washrooms', 'flooring-carpeting'],
      cakes: ['wedding-cake', 'engagement-cake', 'cupcake-tower', 'dessert-table',
        'chocolate-fountain', 'eggless-cakes', 'themed-cakes', 'favour-boxes'],
      gifts: ['guest-favours', 'welcome-hampers', 'trousseau-packing', 'return-gifts',
        'personalised-gifts', 'dry-fruit-boxes', 'sweet-boxes', 'gift-wrapping'],
    };

    /** Name to slug, matching how the catalog admin generates them. */
    const slugify = (name: string): string =>
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);

    let sort = 0;
    for (const category of CATALOG) {
      sort += 10;
      /*
       * New categories are created; the sixteen that exist are renamed to the
       * name the report uses and moved into the order it lists them in --
       * otherwise the sixteen keep the positions they were seeded at and the
       * catalogue reads as a jumble with several categories tied at the same
       * rank. The slug is never touched: vendor listings and bookings resolve
       * through it.
       */
      await queryRunner.query(
        `INSERT INTO "service_categories" ("slug", "name", "sortOrder")
         VALUES ($1, $2, $3)
         ON CONFLICT ("slug") DO UPDATE
           SET "name" = EXCLUDED."name", "sortOrder" = EXCLUDED."sortOrder"`,
        [category.slug, category.name, sort],
      );

      const wanted = new Set(category.services.map(slugify));

      /*
       * Drop the Phase51 guesses this tree supersedes -- but only while
       * nothing sells them. Anything a vendor listed is left alone, which is
       * what the report asks for.
       */
      const superseded = (PHASE51[category.slug] ?? []).filter((slug) => !wanted.has(slug));
      if (superseded.length > 0) {
        await queryRunner.query(
          `DELETE FROM "service_definitions" d
           USING "service_categories" c
           WHERE d."categoryId" = c."id"
             AND c."slug" = $1
             AND d."slug" = ANY($2::text[])
             AND d."id" NOT IN (SELECT "definitionId" FROM "vendor_services")`,
          [category.slug, superseded],
        );
      }

      let serviceSort = 0;
      for (const name of category.services) {
        serviceSort += 10;
        await queryRunner.query(
          `INSERT INTO "service_definitions"
             ("categoryId", "slug", "name", "allowedPricingModels", "sortOrder")
           SELECT c."id", $2, $3, $4::jsonb, $5
           FROM "service_categories" c
           WHERE c."slug" = $1
           ON CONFLICT ("categoryId", "slug") DO NOTHING`,
          [category.slug, slugify(name), name, JSON.stringify(category.pricing), serviceSort],
        );
      }
    }
  }

  /**
   * Removes the nineteen categories this created, and the services under them
   * -- but only while nothing sells them.
   *
   * The renames are not reverted: the previous names are recorded nowhere, and
   * a category's name is administrator-editable anyway.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    const CREATED = [
      'videography', 'hair-stylist', 'mehendi-artist', 'groom-wear', 'jewellery', 'dj-music',
      'live-band', 'sangeet-choreographer', 'wedding-anchor', 'guest-accommodation',
      'guest-hospitality', 'stage-mandap', 'security-valet', 'travel-agency', 'honeymoon',
      'content-creator', 'drone-photography', 'photo-booth', 'digital-invitations',
    ];
    await queryRunner.query(
      `DELETE FROM "service_definitions" d
       USING "service_categories" c
       WHERE d."categoryId" = c."id"
         AND c."slug" = ANY($1::text[])
         AND d."id" NOT IN (SELECT "definitionId" FROM "vendor_services")`,
      [CREATED],
    );
    await queryRunner.query(
      `DELETE FROM "service_categories"
       WHERE "slug" = ANY($1::text[])
         AND "id" NOT IN (SELECT "categoryId" FROM "service_definitions")`,
      [CREATED],
    );
  }
}
