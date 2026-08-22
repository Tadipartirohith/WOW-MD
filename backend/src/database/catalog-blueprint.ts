import {
  AttributeScope,
  AvailabilityModel,
  PricingModel,
  ServiceAttributeType as T,
} from '../common/enums';

/**
 * The catalog the platform starts life with.
 *
 * This file is data, not logic, and that is the whole argument of the service
 * catalog: the seven worked examples in the specification — priest, decorator,
 * makeup artist, venue, transportation, wedding planner, florist — are written
 * out here as configuration rather than shipped as seven modules with seven
 * booking forms and seven pricing rules.
 *
 * Adding an eighth is an entry in this array, or a few rows an administrator
 * writes through `/admin/catalog`. Neither requires a deployment.
 */

export interface AttributeBlueprint {
  scope: AttributeScope;
  key: string;
  label: string;
  type: T;
  required?: boolean;
  filterable?: boolean;
  helpText?: string;
  constraints?: Record<string, unknown>;
}

export interface DefinitionBlueprint {
  slug: string;
  name: string;
  description: string;
  allowedPricingModels: PricingModel[];
  availabilityModel: AvailabilityModel;
  packagesAllowed: boolean;
  defaultCapacity: number;
  attributes: AttributeBlueprint[];
}

export interface CategoryBlueprint {
  slug: string;
  name: string;
  description: string;
  icon: string;
  definitions: DefinitionBlueprint[];
}

const service = (a: Omit<AttributeBlueprint, 'scope'>): AttributeBlueprint => ({
  ...a,
  scope: AttributeScope.SERVICE,
});
const booking = (a: Omit<AttributeBlueprint, 'scope'>): AttributeBlueprint => ({
  ...a,
  scope: AttributeScope.BOOKING,
});

/** Asked of nearly every buyer, so written once rather than seven times. */
const EVENT_DATE = booking({
  key: 'event_date',
  label: 'Date of the function',
  type: T.DATE,
  required: true,
});
const VENUE_ADDRESS = booking({
  key: 'venue_address',
  label: 'Where is it being held?',
  type: T.LOCATION,
  required: true,
  helpText: 'City is enough if the venue is not fixed yet.',
});
const GUEST_COUNT = booking({
  key: 'guest_count',
  label: 'Expected number of guests',
  type: T.NUMBER,
  required: true,
  constraints: { min: 1, max: 100_000 },
});

export const CATALOG_BLUEPRINT: CategoryBlueprint[] = [
  // ------------------------------------------------------------ photography
  {
    slug: 'photography',
    name: 'Photography & Videography',
    description: 'Photographers, cinematographers and the crews that shoot the day.',
    icon: 'camera',
    definitions: [
      {
        slug: 'candid-photography',
        name: 'Candid wedding photography',
        description: 'Documentary coverage of the ceremony and the people at it.',
        allowedPricingModels: [PricingModel.FIXED, PricingModel.PER_DAY, PricingModel.STARTING_FROM],
        availabilityModel: AvailabilityModel.SLOT,
        packagesAllowed: true,
        defaultCapacity: 1,
        attributes: [
          service({
            key: 'crew_size',
            label: 'Photographers on the crew',
            type: T.NUMBER,
            required: true,
            filterable: true,
            constraints: { min: 1, max: 30 },
          }),
          service({
            key: 'styles',
            label: 'Styles covered',
            type: T.MULTI_SELECT,
            filterable: true,
            constraints: {
              options: [
                { value: 'candid', label: 'Candid' },
                { value: 'traditional', label: 'Traditional' },
                { value: 'cinematic', label: 'Cinematic' },
                { value: 'drone', label: 'Drone' },
                { value: 'pre_wedding', label: 'Pre-wedding shoot' },
              ],
            },
          }),
          service({
            key: 'delivery_days',
            label: 'Days until the album is delivered',
            type: T.NUMBER,
            constraints: { min: 1, max: 365 },
          }),
          service({ key: 'portfolio_url', label: 'Portfolio', type: T.URL }),
          EVENT_DATE,
          VENUE_ADDRESS,
          booking({
            key: 'coverage_hours',
            label: 'Hours of coverage needed',
            type: T.DURATION,
            required: true,
            constraints: { min: 1, max: 24, unit: 'hours' },
          }),
          booking({
            key: 'functions',
            label: 'Which functions?',
            type: T.MULTI_SELECT,
            required: true,
            constraints: {
              options: [
                { value: 'engagement', label: 'Engagement' },
                { value: 'haldi', label: 'Haldi' },
                { value: 'mehendi', label: 'Mehendi' },
                { value: 'sangeet', label: 'Sangeet' },
                { value: 'wedding', label: 'Wedding' },
                { value: 'reception', label: 'Reception' },
              ],
            },
          }),
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- catering
  {
    slug: 'catering',
    name: 'Catering',
    description: 'Caterers, cooks and the teams that feed the function.',
    icon: 'utensils',
    definitions: [
      {
        slug: 'wedding-catering',
        name: 'Wedding catering',
        description: 'Full meal service for a function, priced per plate.',
        allowedPricingModels: [
          PricingModel.PER_PERSON,
          PricingModel.STARTING_FROM,
          PricingModel.CUSTOM_QUOTE,
        ],
        availabilityModel: AvailabilityModel.SLOT,
        // The specification's own example: a caterer runs several teams, so one
        // published window takes several bookings.
        packagesAllowed: true,
        defaultCapacity: 5,
        attributes: [
          service({
            key: 'cuisines',
            label: 'Cuisines',
            type: T.MULTI_SELECT,
            required: true,
            filterable: true,
            constraints: {
              options: [
                { value: 'south_indian', label: 'South Indian' },
                { value: 'north_indian', label: 'North Indian' },
                { value: 'andhra', label: 'Andhra' },
                { value: 'chinese', label: 'Chinese' },
                { value: 'continental', label: 'Continental' },
                { value: 'jain', label: 'Jain' },
              ],
            },
          }),
          service({
            key: 'diet',
            label: 'Diets served',
            type: T.MULTI_SELECT,
            filterable: true,
            constraints: {
              options: [
                { value: 'veg', label: 'Vegetarian' },
                { value: 'non_veg', label: 'Non-vegetarian' },
                { value: 'vegan', label: 'Vegan' },
              ],
            },
          }),
          service({
            key: 'min_plates',
            label: 'Minimum plates taken',
            type: T.NUMBER,
            constraints: { min: 1, max: 10_000 },
          }),
          service({ key: 'live_counters', label: 'Live counters offered', type: T.BOOLEAN }),
          EVENT_DATE,
          VENUE_ADDRESS,
          GUEST_COUNT,
          booking({
            key: 'meal',
            label: 'Which meal?',
            type: T.SINGLE_SELECT,
            required: true,
            constraints: {
              options: [
                { value: 'breakfast', label: 'Breakfast' },
                { value: 'lunch', label: 'Lunch' },
                { value: 'dinner', label: 'Dinner' },
                { value: 'all_day', label: 'All day' },
              ],
            },
          }),
          booking({
            key: 'diet_required',
            label: 'Diet required',
            type: T.MULTI_SELECT,
            required: true,
            constraints: {
              options: [
                { value: 'veg', label: 'Vegetarian' },
                { value: 'non_veg', label: 'Non-vegetarian' },
                { value: 'jain', label: 'Jain' },
              ],
            },
          }),
          booking({
            key: 'serving_time',
            label: 'Serving from',
            type: T.TIME,
            required: true,
          }),
        ],
      },
    ],
  },

  // ------------------------------------------------------------------- venue
  {
    slug: 'venue',
    name: 'Venues',
    description: 'Convention halls, lawns, resorts and banquet spaces.',
    icon: 'building',
    definitions: [
      {
        slug: 'convention-hall',
        name: 'Convention hall',
        description: 'A hall booked for the day. One function at a time.',
        allowedPricingModels: [PricingModel.PER_DAY, PricingModel.FIXED, PricingModel.STARTING_FROM],
        availabilityModel: AvailabilityModel.FULL_DAY,
        packagesAllowed: true,
        // A hall is the specification's counter-example to catering: one booking.
        defaultCapacity: 1,
        attributes: [
          service({
            key: 'seating_capacity',
            label: 'Seating capacity',
            type: T.NUMBER,
            required: true,
            filterable: true,
            constraints: { min: 10, max: 50_000 },
          }),
          service({
            key: 'air_conditioned',
            label: 'Air conditioned',
            type: T.BOOLEAN,
            filterable: true,
          }),
          service({
            key: 'parking_spaces',
            label: 'Parking spaces',
            type: T.NUMBER,
            constraints: { min: 0, max: 5_000 },
          }),
          service({
            key: 'in_house_catering',
            label: 'In-house catering only',
            type: T.BOOLEAN,
            helpText: 'Whether outside caterers are allowed.',
          }),
          service({ key: 'location', label: 'Where the venue is', type: T.LOCATION, required: true }),
          service({
            key: 'amenities',
            label: 'Amenities',
            type: T.MULTI_SELECT,
            constraints: {
              options: [
                { value: 'rooms', label: 'Guest rooms' },
                { value: 'generator', label: 'Power backup' },
                { value: 'kitchen', label: 'Kitchen' },
                { value: 'stage', label: 'Stage' },
                { value: 'valet', label: 'Valet parking' },
              ],
            },
          }),
          EVENT_DATE,
          GUEST_COUNT,
          booking({
            key: 'functions',
            label: 'Which functions?',
            type: T.MULTI_SELECT,
            required: true,
            constraints: {
              options: [
                { value: 'wedding', label: 'Wedding' },
                { value: 'reception', label: 'Reception' },
                { value: 'sangeet', label: 'Sangeet' },
                { value: 'engagement', label: 'Engagement' },
              ],
            },
          }),
          booking({
            key: 'rooms_needed',
            label: 'Guest rooms needed',
            type: T.NUMBER,
            constraints: { min: 0, max: 500 },
          }),
        ],
      },
    ],
  },

  // ------------------------------------------------------------------- decor
  {
    slug: 'decor',
    name: 'Decoration & Florals',
    description: 'Decorators, stage designers and florists.',
    icon: 'flower',
    definitions: [
      {
        slug: 'wedding-decoration',
        name: 'Wedding decoration',
        description: 'Stage, mandap, entrance and hall decoration.',
        allowedPricingModels: [
          PricingModel.FIXED,
          PricingModel.STARTING_FROM,
          PricingModel.CUSTOM_QUOTE,
        ],
        // A decorator is on site setting up the day before and clearing the day
        // after, which is what MULTI_DAY exists for.
        availabilityModel: AvailabilityModel.MULTI_DAY,
        packagesAllowed: true,
        defaultCapacity: 2,
        attributes: [
          service({
            key: 'themes',
            label: 'Themes offered',
            type: T.MULTI_SELECT,
            filterable: true,
            constraints: {
              options: [
                { value: 'traditional', label: 'Traditional' },
                { value: 'floral', label: 'Floral' },
                { value: 'royal', label: 'Royal' },
                { value: 'minimal', label: 'Minimal' },
                { value: 'themed', label: 'Custom theme' },
              ],
            },
          }),
          service({
            key: 'setup_hours',
            label: 'Setup time needed',
            type: T.DURATION,
            constraints: { min: 1, max: 96, unit: 'hours' },
          }),
          service({ key: 'travels_outstation', label: 'Travels outstation', type: T.BOOLEAN }),
          EVENT_DATE,
          VENUE_ADDRESS,
          booking({
            key: 'areas',
            label: 'What needs decorating?',
            type: T.MULTI_SELECT,
            required: true,
            constraints: {
              options: [
                { value: 'stage', label: 'Stage' },
                { value: 'mandap', label: 'Mandap' },
                { value: 'entrance', label: 'Entrance' },
                { value: 'hall', label: 'Hall' },
                { value: 'car', label: 'Car' },
              ],
            },
          }),
          booking({
            key: 'colour_theme',
            label: 'Colour theme',
            type: T.TEXT,
            constraints: { maxLength: 120 },
          }),
          booking({
            key: 'reference_image',
            label: 'A reference photo',
            type: T.FILE,
            constraints: { accept: ['.jpg', '.jpeg', '.png', '.webp'] },
          }),
        ],
      },
      {
        slug: 'florist',
        name: 'Florist',
        description: 'Garlands, bouquets and loose flowers, priced by the item.',
        allowedPricingModels: [PricingModel.PER_ITEM, PricingModel.FIXED, PricingModel.CUSTOM_QUOTE],
        availabilityModel: AvailabilityModel.SLOT,
        packagesAllowed: false,
        defaultCapacity: 10,
        attributes: [
          service({
            key: 'flowers',
            label: 'Flowers available',
            type: T.MULTI_SELECT,
            filterable: true,
            constraints: {
              options: [
                { value: 'rose', label: 'Rose' },
                { value: 'jasmine', label: 'Jasmine' },
                { value: 'marigold', label: 'Marigold' },
                { value: 'orchid', label: 'Orchid' },
                { value: 'lily', label: 'Lily' },
              ],
            },
          }),
          service({ key: 'same_day', label: 'Same-day delivery', type: T.BOOLEAN }),
          EVENT_DATE,
          VENUE_ADDRESS,
          booking({
            key: 'items',
            label: 'What do you need?',
            type: T.MULTI_SELECT,
            required: true,
            constraints: {
              options: [
                { value: 'garlands', label: 'Garlands' },
                { value: 'bouquets', label: 'Bouquets' },
                { value: 'loose', label: 'Loose flowers' },
                { value: 'car_decor', label: 'Car decoration' },
              ],
            },
          }),
          booking({
            key: 'delivery_time',
            label: 'Deliver by',
            type: T.TIME,
            required: true,
          }),
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ makeup
  {
    slug: 'makeup',
    name: 'Makeup & Mehendi',
    description: 'Bridal makeup artists, hairstylists and mehendi artists.',
    icon: 'sparkles',
    definitions: [
      {
        slug: 'bridal-makeup',
        name: 'Bridal makeup',
        description: 'Makeup and hair for the bride, and often the family.',
        allowedPricingModels: [
          PricingModel.PER_SESSION,
          PricingModel.FIXED,
          PricingModel.STARTING_FROM,
        ],
        availabilityModel: AvailabilityModel.SLOT,
        packagesAllowed: true,
        defaultCapacity: 1,
        attributes: [
          service({
            key: 'brands',
            label: 'Products used',
            type: T.TEXT,
            constraints: { maxLength: 200 },
          }),
          service({ key: 'travels_to_venue', label: 'Travels to the venue', type: T.BOOLEAN, filterable: true }),
          service({
            key: 'trial_offered',
            label: 'Offers a trial',
            type: T.BOOLEAN,
            filterable: true,
          }),
          service({
            key: 'session_minutes',
            label: 'Typical session length',
            type: T.DURATION,
            constraints: { min: 30, max: 600, unit: 'minutes' },
          }),
          EVENT_DATE,
          VENUE_ADDRESS,
          booking({
            key: 'ready_by',
            label: 'Ready by',
            type: T.TIME,
            required: true,
            helpText: 'The muhurtham time, usually.',
          }),
          booking({
            key: 'people',
            label: 'How many people?',
            type: T.NUMBER,
            required: true,
            constraints: { min: 1, max: 50 },
          }),
          booking({ key: 'trial_wanted', label: 'Want a trial first?', type: T.BOOLEAN }),
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ priest
  {
    slug: 'priest',
    name: 'Priests & Rituals',
    description: 'Purohits and the ceremonies they conduct.',
    icon: 'flame',
    definitions: [
      {
        slug: 'wedding-priest',
        name: 'Wedding priest',
        description: 'A purohit for the ceremony.',
        // The specification's own example of why packages must be optional: a
        // priest sells one ceremony, not a silver/gold/platinum tier.
        allowedPricingModels: [PricingModel.PER_SESSION, PricingModel.FIXED],
        availabilityModel: AvailabilityModel.SLOT,
        packagesAllowed: false,
        defaultCapacity: 1,
        attributes: [
          service({
            key: 'traditions',
            label: 'Traditions',
            type: T.MULTI_SELECT,
            required: true,
            filterable: true,
            constraints: {
              options: [
                { value: 'telugu', label: 'Telugu' },
                { value: 'tamil', label: 'Tamil' },
                { value: 'kannada', label: 'Kannada' },
                { value: 'marathi', label: 'Marathi' },
                { value: 'north_indian', label: 'North Indian' },
                { value: 'bengali', label: 'Bengali' },
              ],
            },
          }),
          service({
            key: 'languages',
            label: 'Languages',
            type: T.MULTI_SELECT,
            filterable: true,
            constraints: {
              options: [
                { value: 'telugu', label: 'Telugu' },
                { value: 'tamil', label: 'Tamil' },
                { value: 'hindi', label: 'Hindi' },
                { value: 'sanskrit', label: 'Sanskrit' },
                { value: 'english', label: 'English' },
              ],
            },
          }),
          service({ key: 'brings_samagri', label: 'Brings the samagri', type: T.BOOLEAN }),
          EVENT_DATE,
          VENUE_ADDRESS,
          booking({
            key: 'ceremony',
            label: 'Which ceremony?',
            type: T.SINGLE_SELECT,
            required: true,
            constraints: {
              options: [
                { value: 'engagement', label: 'Engagement' },
                { value: 'wedding', label: 'Wedding' },
                { value: 'griha_pravesh', label: 'Griha Pravesh' },
                { value: 'satyanarayana', label: 'Satyanarayana Vratam' },
              ],
            },
          }),
          booking({
            key: 'muhurtham',
            label: 'Muhurtham',
            type: T.DATE_TIME,
            required: true,
          }),
          booking({
            key: 'tradition',
            label: 'Tradition to follow',
            type: T.SINGLE_SELECT,
            required: true,
            constraints: {
              options: [
                { value: 'telugu', label: 'Telugu' },
                { value: 'tamil', label: 'Tamil' },
                { value: 'kannada', label: 'Kannada' },
                { value: 'north_indian', label: 'North Indian' },
              ],
            },
          }),
        ],
      },
    ],
  },

  // ---------------------------------------------------------- transportation
  {
    slug: 'transportation',
    name: 'Transportation',
    description: 'Cars, buses and the baraat.',
    icon: 'car',
    definitions: [
      {
        slug: 'guest-transport',
        name: 'Guest transport',
        description: 'Vehicles for guests, priced by the vehicle and the day.',
        allowedPricingModels: [PricingModel.PER_ITEM, PricingModel.PER_DAY, PricingModel.PER_HOUR],
        availabilityModel: AvailabilityModel.SLOT,
        packagesAllowed: false,
        defaultCapacity: 8,
        attributes: [
          service({
            key: 'vehicle_types',
            label: 'Vehicles available',
            type: T.MULTI_SELECT,
            required: true,
            filterable: true,
            constraints: {
              options: [
                { value: 'sedan', label: 'Sedan' },
                { value: 'suv', label: 'SUV' },
                { value: 'tempo', label: 'Tempo traveller' },
                { value: 'bus', label: 'Bus' },
                { value: 'vintage', label: 'Vintage car' },
                { value: 'horse', label: 'Horse' },
              ],
            },
          }),
          service({
            key: 'fleet_size',
            label: 'Vehicles in the fleet',
            type: T.NUMBER,
            constraints: { min: 1, max: 500 },
          }),
          service({ key: 'driver_included', label: 'Driver included', type: T.BOOLEAN }),
          service({
            key: 'service_radius_km',
            label: 'Distance covered',
            type: T.RANGE,
            constraints: { min: 0, max: 2_000 },
          }),
          EVENT_DATE,
          booking({
            key: 'pickup',
            label: 'Pick up from',
            type: T.LOCATION,
            required: true,
          }),
          booking({
            key: 'drop',
            label: 'Drop at',
            type: T.LOCATION,
            required: true,
          }),
          booking({
            key: 'pickup_time',
            label: 'Pick-up time',
            type: T.TIME,
            required: true,
          }),
          booking({
            key: 'passengers',
            label: 'How many people?',
            type: T.NUMBER,
            required: true,
            constraints: { min: 1, max: 2_000 },
          }),
        ],
      },
    ],
  },

  // ----------------------------------------------------------------- planner
  {
    slug: 'planning',
    name: 'Wedding Planning',
    description: 'Planners who run the whole wedding, or one function of it.',
    icon: 'clipboard',
    definitions: [
      {
        slug: 'full-wedding-planning',
        name: 'Full wedding planning',
        description: 'End-to-end planning and coordination across every function.',
        allowedPricingModels: [
          PricingModel.CUSTOM_QUOTE,
          PricingModel.STARTING_FROM,
          PricingModel.FIXED,
        ],
        availabilityModel: AvailabilityModel.MULTI_DAY,
        packagesAllowed: true,
        defaultCapacity: 3,
        attributes: [
          service({
            key: 'services_covered',
            label: 'What the planner handles',
            type: T.MULTI_SELECT,
            required: true,
            filterable: true,
            constraints: {
              options: [
                { value: 'venue', label: 'Venue' },
                { value: 'catering', label: 'Catering' },
                { value: 'decor', label: 'Decor' },
                { value: 'photography', label: 'Photography' },
                { value: 'entertainment', label: 'Entertainment' },
                { value: 'logistics', label: 'Guest logistics' },
              ],
            },
          }),
          service({
            key: 'weddings_done',
            label: 'Weddings planned',
            type: T.NUMBER,
            constraints: { min: 0, max: 10_000 },
          }),
          service({
            key: 'budget_range',
            label: 'Budgets worked with',
            type: T.RANGE,
            filterable: true,
            constraints: { min: 0, max: 100_000_000 },
          }),
          service({ key: 'destination_weddings', label: 'Destination weddings', type: T.BOOLEAN }),
          booking({
            key: 'wedding_dates',
            label: 'Wedding dates',
            type: T.RANGE,
            required: true,
            helpText: 'How many days from the first function to the last.',
            constraints: { min: 1, max: 30 },
          }),
          VENUE_ADDRESS,
          GUEST_COUNT,
          booking({
            key: 'total_budget',
            label: 'Overall budget',
            type: T.CURRENCY,
            constraints: { min: 0 },
          }),
          booking({
            key: 'help_needed',
            label: 'What do you need help with?',
            type: T.MULTI_SELECT,
            required: true,
            constraints: {
              options: [
                { value: 'everything', label: 'Everything' },
                { value: 'vendors', label: 'Finding vendors' },
                { value: 'on_the_day', label: 'On-the-day coordination' },
                { value: 'budget', label: 'Budget management' },
              ],
            },
          }),
        ],
      },
    ],
  },

  // ----------------------------------------------------------- entertainment
  {
    slug: 'entertainment',
    name: 'Entertainment',
    description: 'Bands, DJs, dancers and the sangeet.',
    icon: 'music',
    definitions: [
      {
        slug: 'dj-and-sound',
        name: 'DJ and sound',
        description: 'Music and sound for the sangeet or the reception.',
        allowedPricingModels: [PricingModel.PER_HOUR, PricingModel.PER_SESSION, PricingModel.FIXED],
        availabilityModel: AvailabilityModel.SLOT,
        packagesAllowed: true,
        defaultCapacity: 2,
        attributes: [
          service({
            key: 'genres',
            label: 'Genres',
            type: T.MULTI_SELECT,
            filterable: true,
            constraints: {
              options: [
                { value: 'bollywood', label: 'Bollywood' },
                { value: 'tollywood', label: 'Tollywood' },
                { value: 'punjabi', label: 'Punjabi' },
                { value: 'edm', label: 'EDM' },
                { value: 'retro', label: 'Retro' },
              ],
            },
          }),
          service({ key: 'brings_lighting', label: 'Brings lighting', type: T.BOOLEAN }),
          service({
            key: 'setup_minutes',
            label: 'Setup time',
            type: T.DURATION,
            constraints: { min: 15, max: 480, unit: 'minutes' },
          }),
          EVENT_DATE,
          VENUE_ADDRESS,
          booking({
            key: 'play_from',
            label: 'Start at',
            type: T.TIME,
            required: true,
          }),
          booking({
            key: 'hours',
            label: 'For how long?',
            type: T.DURATION,
            required: true,
            constraints: { min: 1, max: 12, unit: 'hours' },
          }),
        ],
      },
    ],
  },
];
