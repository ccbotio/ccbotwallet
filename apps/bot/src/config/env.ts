import { z } from 'zod';

// Load dotenv in development mode before parsing env
if (process.env.NODE_ENV !== 'production') {
  const { config } = await import('dotenv');
  config();
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_MINI_APP_URL: z.string().url().optional(),
  MINI_APP_URL: z.string().url().optional(),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  CANTON_NETWORK: z.enum(['devnet', 'testnet', 'mainnet']).default('devnet'),
  CANTON_LEDGER_API_URL: z.string().url().optional().or(z.literal('')),
  CANTON_VALIDATOR_API_URL: z.string().url().optional().or(z.literal('')),
  CANTON_SCAN_URL: z.string().url().optional(),
  CANTON_PARTICIPANT_ID: z.string().optional(),
  CANTON_LEDGER_API_USER: z.string().optional(),
  CANTON_VALIDATOR_AUDIENCE: z.string().optional(),
  CANTON_DSO_PARTY_ID: z.string().optional(),
  CANTON_PROVIDER_PARTY_ID: z.string().optional(),
  CANTON_FAUCET_URL: z.string().url().optional(),
  CANTON_SIMULATION_MODE: z.enum(['true', 'false', '1', '0']).default('true').transform(v => v === 'true' || v === '1'),
  // Unsafe JWT secret for validators that use HS256 auth (e.g., 'unsafe' for devnet/test validators)
  CANTON_UNSAFE_SECRET: z.string().optional(),

  APP_SECRET: z.string().min(64),
  ENCRYPTION_KEY: z.string().length(64),

  BOTBASHER_API_KEY: z.string().optional(),
  NOVES_API_KEY: z.string().optional(),

  // Email (Resend) - optional in development
  // EMAIL_FROM can be "email@domain.com" or "Name <email@domain.com>"
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).default('CC Bot Wallet <noreply@ccbot.io>'),

  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // Whitelist - comma-separated Telegram IDs (empty = everyone allowed)
  WHITELIST_TELEGRAM_IDS: z.string().optional().default(''),

  // AI Agent (Claude API)
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AI_AGENT_MODEL: z.string().default('claude-sonnet-4-20250514'),
  AI_AGENT_MAX_TOKENS: z.coerce.number().default(1024),

  // Development auth bypass (allows dev_mode_TELEGRAM_ID authentication)
  DEV_AUTH_BYPASS: z.enum(['true', 'false', '1', '0']).default('false').transform(v => v === 'true' || v === '1'),

  // Treasury configuration for swap service
  TREASURY_PARTY_ID: z.string().optional(),
  TREASURY_PRIVATE_KEY: z.string().optional(),

  // Admin alerting (comma-separated Telegram IDs)
  ADMIN_TELEGRAM_IDS: z.string().optional().default(''),

  // Admin API key - required in production, has dev default for local development
  ADMIN_API_KEY: z.string().min(1).default('dev-admin-key'),
});

// Production-specific validation
const productionRequiredEnv = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(40, 'Bot token appears invalid'),
  APP_SECRET: z.string().min(64, 'APP_SECRET must be at least 64 characters'),
  ENCRYPTION_KEY: z.string().length(64, 'ENCRYPTION_KEY must be exactly 64 hex characters'),
  ADMIN_API_KEY: z.string()
    .min(32, 'ADMIN_API_KEY must be at least 32 characters in production')
    .refine(
      (val) => val !== 'dev-admin-key',
      { message: 'Cannot use default dev-admin-key in production' }
    ),
  DATABASE_URL: z.string().startsWith('postgresql://', 'Invalid DATABASE_URL'),
  REDIS_URL: z.string().startsWith('redis://', 'Invalid REDIS_URL'),
  CANTON_VALIDATOR_API_URL: z.string().url('CANTON_VALIDATOR_API_URL is required in production'),
  CANTON_LEDGER_API_URL: z.string().url('CANTON_LEDGER_API_URL is required in production'),
});

// Mainnet-specific validation (stricter than production)
const mainnetRequiredEnv = z.object({
  CANTON_NETWORK: z.literal('mainnet'),
  // Canton URLs must not be localhost
  CANTON_LEDGER_API_URL: z.string()
    .url('CANTON_LEDGER_API_URL must be a valid URL')
    .refine(
      (val) => !val.includes('localhost') && !val.includes('127.0.0.1'),
      { message: 'Localhost URLs not allowed for mainnet' }
    ),
  CANTON_VALIDATOR_API_URL: z.string()
    .url('CANTON_VALIDATOR_API_URL must be a valid URL')
    .refine(
      (val) => !val.includes('localhost') && !val.includes('127.0.0.1'),
      { message: 'Localhost URLs not allowed for mainnet' }
    ),
  // Admin telegram IDs required for mainnet alerts
  ADMIN_TELEGRAM_IDS: z.string()
    .min(1, 'ADMIN_TELEGRAM_IDS required for mainnet alerting'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }

  const env = result.data;

  // Additional validation for production environment
  if (env.NODE_ENV === 'production') {
    const prodResult = productionRequiredEnv.safeParse(process.env);
    if (!prodResult.success) {
      console.error('Missing or invalid production environment variables:');
      prodResult.error.issues.forEach((issue) => {
        console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
      });
      console.error('\nProduction deployment blocked due to configuration errors.');
      process.exit(1);
    }
  }

  // Additional validation for mainnet deployment
  if (env.CANTON_NETWORK === 'mainnet') {
    const mainnetResult = mainnetRequiredEnv.safeParse(process.env);
    if (!mainnetResult.success) {
      console.error('Missing or invalid mainnet environment variables:');
      mainnetResult.error.issues.forEach((issue) => {
        console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
      });
      console.error('\nMainnet deployment blocked due to configuration errors.');
      process.exit(1);
    }
  }

  return env;
}

export const env = loadEnv();
