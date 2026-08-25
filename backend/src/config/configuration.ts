/**
 * Central configuration loader.
 *
 * Every tunable value in the system is read from environment variables HERE and
 * nowhere else. Application code reads settings through AppConfigService (typed),
 * never via process.env directly. Operators/testers change behaviour by editing
 * `.env` (or Kubernetes ConfigMaps/Secrets), never the source code.
 */

const toNumber = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toBool = (value: string | undefined, fallback = false): boolean =>
  value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());

const toList = (value: string | undefined, fallback: string[] = []): string[] =>
  value ? value.split(',').map((s) => s.trim()).filter(Boolean) : fallback;

export default () => ({
  runtime: {
    env: process.env.NODE_ENV || 'development',
    port: toNumber(process.env.PORT, 3000),
    apiPrefix: process.env.API_PREFIX || 'api',
    logLevel: process.env.LOG_LEVEL || 'info',
    corsOrigins: toList(process.env.CORS_ORIGINS, ['http://localhost:5173']),
    swaggerEnabled: toBool(process.env.SWAGGER_ENABLED, true),
  },

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: toNumber(process.env.DB_PORT, 5432),
    username: process.env.DB_USER || 'wow_user',
    password: process.env.DB_PASSWORD || 'wow_password',
    name: process.env.DB_NAME || 'wow_db',
    ssl: toBool(process.env.DB_SSL, false),
    poolSize: toNumber(process.env.DB_POOL_SIZE, 10),
    // NEVER true in production, schema is managed by migrations.
    synchronize: false,
    logging: toBool(process.env.DB_LOGGING, false),
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: toNumber(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    defaultTtlSeconds: toNumber(process.env.REDIS_DEFAULT_TTL, 300),
  },

  /**
   * Switches for behaviour the business turns on and off per environment.
   *
   * `individualUserEnabled` is the Phase 1 flag: with it off, the platform runs
   * as an agent-only brokerage and nobody can create their own matchmaking
   * account. Existing individual accounts keep working — the flag gates the
   * front door, not the people already inside, because locking out live users
   * on a config change would be a far worse failure than an open door.
   */
  features: {
    individualUserEnabled: toBool(process.env.INDIVIDUAL_USER_ENABLED, true),
    /** Strip contact numbers out of chat messages before they are stored. */
    chatRedactContacts: toBool(process.env.CHAT_REDACT_CONTACTS, true),

    /**
     * Whether vendor and planner services stay locked until a match is fixed.
     *
     * On by default because that is the product: people come here to find a
     * match, and the wedding marketplace is what they graduate into. An
     * operator running the services side as a standalone marketplace turns it
     * off.
     */
    // Off by default: the revenue is in vendor bookings, and a couple whose
    // match was fixed at home rather than here is still a couple with a
    // wedding to buy. An operator who wants matchmaking to be the front door
    // to the marketplace turns it back on.
    servicesRequireMatchFixed: toBool(process.env.SERVICES_REQUIRE_MATCH_FIXED, false),
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-only-refresh-change-me',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    bcryptRounds: toNumber(process.env.BCRYPT_ROUNDS, 12),
    otpTtlSeconds: toNumber(process.env.OTP_TTL_SECONDS, 300),

    // Refresh tokens ride in an httpOnly cookie so page script cannot read
    // them. `cookieSecure` must be true anywhere the site is served over TLS.
    refreshCookieName: process.env.REFRESH_COOKIE_NAME || 'wow_rt',
    cookieSecure: toBool(process.env.COOKIE_SECURE, false),
    cookieSameSite: (process.env.COOKIE_SAME_SITE || 'lax') as 'lax' | 'strict' | 'none',
    cookieDomain: process.env.COOKIE_DOMAIN || undefined,

    // Brute-force protection.
    maxFailedLogins: toNumber(process.env.MAX_FAILED_LOGINS, 8),
    lockoutMinutes: toNumber(process.env.LOCKOUT_MINUTES, 15),

    // Single-use email token lifetimes.
    invitationTtlHours: toNumber(process.env.INVITATION_TTL_HOURS, 168),
    emailVerifyTtlHours: toNumber(process.env.EMAIL_VERIFY_TTL_HOURS, 48),
    passwordResetTtlMinutes: toNumber(process.env.PASSWORD_RESET_TTL_MINUTES, 30),
    rsvpTokenTtlDays: toNumber(process.env.RSVP_TOKEN_TTL_DAYS, 120),

    // Two-factor. Required for admins by default: they can release escrow and
    // suspend accounts, so a stolen password must not be enough.
    mfaIssuer: process.env.MFA_ISSUER || 'WOW Weddings',
    mfaRequiredForAdmin: toBool(process.env.MFA_REQUIRED_FOR_ADMIN, true),
  },

  mail: {
    provider: process.env.MAIL_PROVIDER || 'log', // log | smtp
    from: process.env.MAIL_FROM || 'WOW <no-reply@wow.local>',
    host: process.env.SMTP_HOST || '',
    port: toNumber(process.env.SMTP_PORT, 587),
    secure: toBool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    /** Base URL the action links in emails point at (the SPA, not the API). */
    appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:8080',
  },

  /**
   * SMS. Phone-first intake made this the channel that actually reaches a
   * family — an agent can take on a client with no email address at all.
   */
  sms: {
    provider: process.env.SMS_PROVIDER || 'log', // log | http
    url: process.env.SMS_URL || '',
    apiKey: process.env.SMS_API_KEY || '',
    senderId: process.env.SMS_SENDER_ID || 'WOWMAT',
    /** Most Indian gateways require a pre-registered DLT template id. */
    templateId: process.env.SMS_TEMPLATE_ID || '',
    timeoutMs: toNumber(process.env.SMS_TIMEOUT_MS, 8000),
    /** How long a phone verification code stays valid. */
    verificationTtlMinutes: toNumber(process.env.PHONE_VERIFY_TTL_MINUTES, 10),
  },

  /**
   * WebRTC. Only the signalling runs here — the media goes browser to browser,
   * which is what makes calling affordable at all.
   *
   * Public STUN covers most home and mobile networks. A symmetric NAT on either
   * side needs a TURN relay, which carries the audio and therefore costs real
   * money. Set `TURN_URL` plus `TURN_STATIC_AUTH_SECRET` and the relay is live.
   *
   * The ICE list is built per call rather than read from here, because
   * ephemeral TURN credentials expire — see `modules/chat/ice-servers.ts`. Only
   * the static shape is exposed here, for anything that wants to know whether a
   * relay is configured at all.
   */
  webrtc: {
    turnConfigured: Boolean(process.env.TURN_URL?.trim()),
    /**
     * Whether the relay is using credentials a leaked one cannot outlive.
     * Reported so an operator can see, from /health, which mode they are in.
     */
    turnEphemeral: Boolean(process.env.TURN_STATIC_AUTH_SECRET?.trim()),
  },

  security: {
    rateLimitTtlSeconds: toNumber(process.env.RATE_LIMIT_TTL, 60),
    rateLimitMax: toNumber(process.env.RATE_LIMIT_MAX, 120),
    authRateLimitMax: toNumber(process.env.AUTH_RATE_LIMIT_MAX, 10),
  },

  pagination: {
    defaultLimit: toNumber(process.env.PAGINATION_DEFAULT_LIMIT, 20),
    maxLimit: toNumber(process.env.PAGINATION_MAX_LIMIT, 100),
  },

  stewardship: {
    /** How many unclaimed profiles one steward may hold at once. */
    maxManagedProfiles: toNumber(process.env.MAX_MANAGED_PROFILES, 200),
    /** Family accounts look after relatives, not a book of business. */
    maxManagedProfilesFamily: toNumber(process.env.MAX_MANAGED_PROFILES_FAMILY, 5),
    maxInvitationResends: toNumber(process.env.MAX_INVITATION_RESENDS, 5),
    /** Agents must be approved by an admin before they can build profiles. */
    requireAgentApproval: toBool(process.env.REQUIRE_AGENT_APPROVAL, true),
    /**
     * How long circulation consent stands before the family has to be asked
     * again. Intake consent does not expire; permission to pass details around
     * should not be assumed indefinitely.
     */
    circulationConsentValidityDays: toNumber(process.env.CIRCULATION_CONSENT_VALIDITY_DAYS, 365),
    /** Default lifetime of a shared biodata link. */
    shareLinkTtlDays: toNumber(process.env.SHARE_LINK_TTL_DAYS, 30),
  },

  /**
   * Matchmaking business tunables. Product/ops can re-weight the compatibility
   * engine without a code change or redeploy, just update env and restart.
   */
  matchmaking: {
    /**
     * How many profiles one agency may hold in the shared network pool. The
     * pool is a common resource and nothing stopped one agency filling it.
     */
    poolQuotaPerAgency: toNumber(process.env.POOL_QUOTA_PER_AGENCY, 50),
    weightAge: toNumber(process.env.MATCH_WEIGHT_AGE, 20),
    weightLocation: toNumber(process.env.MATCH_WEIGHT_LOCATION, 20),
    weightReligion: toNumber(process.env.MATCH_WEIGHT_RELIGION, 20),
    weightEducation: toNumber(process.env.MATCH_WEIGHT_EDUCATION, 15),
    weightLifestyle: toNumber(process.env.MATCH_WEIGHT_LIFESTYLE, 15),
    weightPreferences: toNumber(process.env.MATCH_WEIGHT_PREFERENCES, 10),
    maxAgeGap: toNumber(process.env.MATCH_MAX_AGE_GAP, 8),
    minScore: toNumber(process.env.MATCH_MIN_SCORE, 50),
    suggestionsCacheTtlSeconds: toNumber(process.env.MATCH_SUGGESTIONS_CACHE_TTL, 120),
    maxSuggestions: toNumber(process.env.MATCH_MAX_SUGGESTIONS, 50),
  },

  media: {
    cdnBaseUrl: process.env.CDN_BASE_URL || '',
    s3Bucket: process.env.S3_BUCKET || '',
    s3Region: process.env.S3_REGION || '',
    maxFileSizeBytes: toNumber(process.env.MAX_FILE_SIZE, 10 * 1024 * 1024),
    // 'mock' returns fake presigned URLs for local/testing; 's3' uses real S3.
    storageProvider: process.env.MEDIA_STORAGE_PROVIDER || 'mock',
    shareBaseUrl: process.env.MEDIA_SHARE_BASE_URL || 'http://localhost:5173/album',
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    presignExpirySeconds: toNumber(process.env.S3_PRESIGN_EXPIRY, 900),
  },

  payments: {
    // 'mock' simulates escrow without a real gateway; 'razorpay' uses live keys.
    provider: process.env.PAYMENT_PROVIDER || 'mock',
    currency: process.env.PAYMENT_CURRENCY || 'INR',
    commissionPercent: toNumber(process.env.PAYMENT_COMMISSION_PERCENT, 10),
    /** HMAC secret the gateway signs webhook bodies with. */
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',

    /**
     * How a booking's total is split across the three escrow milestones. Wedding
     * vendors are paid this way in practice: something to hold the date,
     * something as the event approaches, the balance on delivery.
     *
     * The three must add to 100; the config module refuses to boot otherwise,
     * because a silent mismatch would quietly under- or over-charge every
     * booking on the platform.
     */
    milestonePercents: {
      advance: toNumber(process.env.ESCROW_ADVANCE_PERCENT, 30),
      second: toNumber(process.env.ESCROW_SECOND_PERCENT, 30),
      final: toNumber(process.env.ESCROW_FINAL_PERCENT, 40),
    },

    /** What an agency charges to build and run a client profile, in rupees. */
    agentProfileFee: toNumber(process.env.AGENT_PROFILE_FEE, 2000),
    /** The agency's success fee, due once a match is fixed. */
    agentSettlementFee: toNumber(process.env.AGENT_SETTLEMENT_FEE, 25000),
  },

  identity: {
    /**
     * UIDAI does not issue credentials to a marketplace directly; verification
     * runs through a licensed AUA/KUA. 'mock' exercises the whole flow locally
     * and hands the code back on the response, which is why it must never be
     * the setting in production.
     */
    aadhaarProvider: process.env.AADHAAR_PROVIDER || 'mock',

    /**
     * The licensed provider's endpoint and credentials.
     *
     * Which provider is behind this is configuration rather than a code fork:
     * they have converged on the same two-call conversation, and only the base
     * URL and the credential names differ.
     *
     * AADHAAR_API_KEY / _SECRET are the older names for the same two values,
     * kept working so an existing deployment does not break on upgrade.
     */
    aadhaarBaseUrl: process.env.AADHAAR_BASE_URL || '',
    aadhaarClientId: process.env.AADHAAR_CLIENT_ID || process.env.AADHAAR_API_KEY || '',
    aadhaarClientSecret:
      process.env.AADHAAR_CLIENT_SECRET || process.env.AADHAAR_API_SECRET || '',
    /** A verification provider that hangs must not hold a request worker with it. */
    aadhaarTimeoutMs: toNumber(process.env.AADHAAR_TIMEOUT_MS, 15_000),
  },

  /**
   * Whether a photograph is a photograph.
   *
   * A matrimonial profile is a claim about a real person; a generated face
   * makes the government ID, the in-person visit and the family's consent all
   * attach to somebody who does not exist. The default provider refuses what is
   * plainly labelled and allows the rest, which keeps the rejection path
   * exercised without needing a contract to run the application.
   */
  /**
   * How long the platform has to verify a business once it has been asked.
   *
   * The clock starts at submission, not at creation: a vendor sitting on a
   * draft for a month is not a breach, and starting it earlier would make every
   * slow vendor look like a slow platform.
   */
  verification: {
    slaHours: toNumber(process.env.VERIFICATION_SLA_HOURS, 72),
  },

  moderation: {
    imageProvider: process.env.IMAGE_MODERATION_PROVIDER || 'heuristic',
    imageModerationUrl: process.env.IMAGE_MODERATION_URL || '',
    imageModerationKey: process.env.IMAGE_MODERATION_KEY || '',
    /** Detectors score differently and drift; a compiled-in number cannot be tuned. */
    imageModerationThreshold: Number(process.env.IMAGE_MODERATION_THRESHOLD) || 0.85,
    imageModerationTimeoutMs: toNumber(process.env.IMAGE_MODERATION_TIMEOUT_MS, 8_000),
  },

  ai: {
    // 'mock' uses deterministic, rule-based responses; 'openai' calls an LLM.
    provider: process.env.AI_PROVIDER || 'mock',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  },

  // Optional graph database for matchmaking. Off by default; when enabled the
  // matchmaking engine uses graph traversal and falls back to Postgres if the
  // graph is unreachable.
  neo4j: {
    enabled: toBool(process.env.NEO4J_ENABLED, false),
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USERNAME || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'wow_password',
  },

  // Optional event streaming. Off by default; when enabled the outbox also
  // publishes domain events to Kafka in addition to the in-process bus.
  kafka: {
    enabled: toBool(process.env.KAFKA_ENABLED, false),
    brokers: toList(process.env.KAFKA_BROKERS, ['localhost:9092']),
    clientId: process.env.KAFKA_CLIENT_ID || 'wow-backend',
    topic: process.env.KAFKA_TOPIC || 'wow.domain-events',
  },
});
