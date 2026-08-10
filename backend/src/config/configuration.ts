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

  auth: {
    jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-only-refresh-change-me',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    bcryptRounds: toNumber(process.env.BCRYPT_ROUNDS, 12),
    otpTtlSeconds: toNumber(process.env.OTP_TTL_SECONDS, 300),
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

  /**
   * Matchmaking business tunables. Product/ops can re-weight the compatibility
   * engine without a code change or redeploy, just update env and restart.
   */
  matchmaking: {
    weightAge: toNumber(process.env.MATCH_WEIGHT_AGE, 20),
    weightLocation: toNumber(process.env.MATCH_WEIGHT_LOCATION, 20),
    weightReligion: toNumber(process.env.MATCH_WEIGHT_RELIGION, 20),
    weightEducation: toNumber(process.env.MATCH_WEIGHT_EDUCATION, 15),
    weightLifestyle: toNumber(process.env.MATCH_WEIGHT_LIFESTYLE, 15),
    weightPreferences: toNumber(process.env.MATCH_WEIGHT_PREFERENCES, 10),
    maxAgeGap: toNumber(process.env.MATCH_MAX_AGE_GAP, 8),
    minScore: toNumber(process.env.MATCH_MIN_SCORE, 40),
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
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
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
