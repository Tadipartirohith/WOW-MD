import * as Joi from 'joi';

/**
 * Boot-time validation of environment variables. The app FAILS FAST if a
 * required variable is missing or malformed, so misconfiguration is caught at
 * startup rather than at runtime. In production, secrets have no safe default
 * and must be supplied.
 */
export const configValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'staging', 'production').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api'),
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),
  CORS_ORIGINS: Joi.string().optional(),
  SWAGGER_ENABLED: Joi.string().optional(),

  // Database
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  DB_SSL: Joi.string().optional(),
  DB_POOL_SIZE: Joi.number().default(10),
  DB_LOGGING: Joi.string().optional(),

  // Redis
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_DEFAULT_TTL: Joi.number().default(300),

  // Auth, secrets must not use the insecure defaults in production.
  JWT_SECRET: Joi.string().min(16).when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(32).required(),
  }),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(16).when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(32).required(),
  }),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),
  BCRYPT_ROUNDS: Joi.number().min(10).max(15).default(12),
  OTP_TTL_SECONDS: Joi.number().default(300),

  // Security
  RATE_LIMIT_TTL: Joi.number().default(60),
  RATE_LIMIT_MAX: Joi.number().default(120),
  AUTH_RATE_LIMIT_MAX: Joi.number().default(10),

  // Pagination
  PAGINATION_DEFAULT_LIMIT: Joi.number().default(20),
  PAGINATION_MAX_LIMIT: Joi.number().default(100),

  // Matchmaking tunables
  MATCH_WEIGHT_AGE: Joi.number().default(20),
  MATCH_WEIGHT_LOCATION: Joi.number().default(20),
  MATCH_WEIGHT_RELIGION: Joi.number().default(20),
  MATCH_WEIGHT_EDUCATION: Joi.number().default(15),
  MATCH_WEIGHT_LIFESTYLE: Joi.number().default(15),
  MATCH_WEIGHT_PREFERENCES: Joi.number().default(10),
  MATCH_MAX_AGE_GAP: Joi.number().default(8),
  MATCH_MIN_SCORE: Joi.number().min(0).max(100).default(40),
  MATCH_SUGGESTIONS_CACHE_TTL: Joi.number().default(120),
  MATCH_MAX_SUGGESTIONS: Joi.number().default(50),

  // Media
  CDN_BASE_URL: Joi.string().allow('').optional(),
  S3_BUCKET: Joi.string().allow('').optional(),
  S3_REGION: Joi.string().allow('').optional(),
  MAX_FILE_SIZE: Joi.number().default(10485760),
  MEDIA_STORAGE_PROVIDER: Joi.string().valid('mock', 's3').default('mock'),
  MEDIA_SHARE_BASE_URL: Joi.string().allow('').optional(),
  S3_ACCESS_KEY_ID: Joi.string().allow('').optional(),
  S3_SECRET_ACCESS_KEY: Joi.string().allow('').optional(),
  S3_PRESIGN_EXPIRY: Joi.number().default(900),

  // Payments
  PAYMENT_PROVIDER: Joi.string().valid('mock', 'razorpay').default('mock'),
  PAYMENT_CURRENCY: Joi.string().default('INR'),
  PAYMENT_COMMISSION_PERCENT: Joi.number().min(0).max(100).default(10),
  RAZORPAY_KEY_ID: Joi.string().allow('').optional(),
  RAZORPAY_KEY_SECRET: Joi.string().allow('').optional(),

  // AI
  AI_PROVIDER: Joi.string().valid('mock', 'openai').default('mock'),
  AI_API_KEY: Joi.string().allow('').optional(),
  AI_MODEL: Joi.string().default('gpt-4o-mini'),
  AI_BASE_URL: Joi.string().allow('').optional(),

  // Neo4j (optional)
  NEO4J_ENABLED: Joi.string().optional(),
  NEO4J_URI: Joi.string().allow('').optional(),
  NEO4J_USERNAME: Joi.string().allow('').optional(),
  NEO4J_PASSWORD: Joi.string().allow('').optional(),

  // Kafka (optional)
  KAFKA_ENABLED: Joi.string().optional(),
  KAFKA_BROKERS: Joi.string().allow('').optional(),
  KAFKA_CLIENT_ID: Joi.string().allow('').optional(),
  KAFKA_TOPIC: Joi.string().allow('').optional(),
});
