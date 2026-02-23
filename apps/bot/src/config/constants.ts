export const BOT_COMMANDS = [
  { command: 'start', description: 'Start the bot and create wallet' },
  { command: 'balance', description: 'Quick balance check' },
  { command: 'wallet', description: 'View wallet details' },
  { command: 'send', description: 'Send CC tokens' },
  { command: 'receive', description: 'Show receive address' },
  { command: 'history', description: 'Transaction history' },
  { command: 'help', description: 'Show help' },
] as const;

export const RATE_LIMITS = {
  commands: { max: 30, window: 60 },
  transactions: { max: 10, window: 60 },
  pinAttempts: { max: 5, window: 900 }, // 5 attempts per 15 minutes
  sessionHeartbeat: { max: 120, window: 60 }, // 120 heartbeats per minute (allow frequent polling)
} as const;

export const SESSION_LOCK_CONFIG = {
  defaultTimeout: 300, // 5 minutes
  minTimeout: 60, // 1 minute
  maxTimeout: 3600, // 1 hour
  cacheSeconds: 60, // 1 minute cache for lock status
} as const;

export const CACHE_TTL = {
  balance: 30,
  user: 300,
  transactions: 60,
} as const;

export const JOB_QUEUES = {
  notifications: 'notifications',
  utxoMerge: 'utxo-merge',
  cantonSync: 'canton-sync',
} as const;

export const UTXO_MERGE_CONFIG = {
  maxUtxos: 10, // Merge when UTXO count exceeds this
  checkIntervalMs: 5 * 60 * 1000, // Check every 5 minutes
} as const;

export const CANTON_SYNC_CONFIG = {
  checkIntervalMs: 2 * 60 * 1000, // Sync every 2 minutes
} as const;
