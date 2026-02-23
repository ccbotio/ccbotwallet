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

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  CANTON_NETWORK: z.enum(['devnet', 'testnet', 'mainnet']).default('devnet'),
  CANTON_LEDGER_API_URL: z.string().url().optional().or(z.literal('')),
  CANTON_VALIDATOR_API_URL: z.string().url().optional().or(z.literal('')),
  CANTON_PARTICIPANT_ID: z.string().optional(),
  CANTON_LEDGER_API_USER: z.string().optional(),
  CANTON_VALIDATOR_AUDIENCE: z.string().optional(),
  CANTON_DSO_PARTY_ID: z.string().optional(),
  CANTON_PROVIDER_PARTY_ID: z.string().optional(),
  CANTON_FAUCET_URL: z.string().url().optional(),
  CANTON_SIMULATION_MODE: z.enum(['true', 'false', '1', '0']).default('true').transform(v => v === 'true' || v === '1'),

  APP_SECRET: z.string().min(64),
  ENCRYPTION_KEY: z.string().length(64),

  BOTBASHER_API_KEY: z.string().optional(),
  NOVES_API_KEY: z.string().optional(),

  // Email (Resend) - optional in development
  // EMAIL_FROM can be "email@domain.com" or "Name <email@domain.com>"
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).default('CC Bot Wallet <noreply@ccbot.app>'),

  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
