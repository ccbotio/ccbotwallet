export const BOT_COMMANDS = [
  { command: 'start', description: 'Start the bot and create wallet' },
  { command: 'balance', description: 'Quick balance check' },
  { command: 'wallet', description: 'View wallet details' },
  { command: 'send', description: 'Send CC tokens' },
  { command: 'receive', description: 'Show receive address' },
  { command: 'history', description: 'Transaction history' },
  { command: 'help', description: 'Show help' },
] as const;

/**
 * Rate Limits Configuration
 * All limits are enforced via Redis sliding window
 * DEV_MODE bypasses all limits for testing
 */
export const RATE_LIMITS = {
  // ============ API GENERAL ============
  // Authenticated user requests
  api: { max: 60, window: 60 },                    // 60 requests/minute
  // Unauthenticated IP requests
  apiUnauthenticated: { max: 20, window: 60 },     // 20 requests/minute
  // Burst protection (per second)
  apiBurst: { max: 10, window: 1 },                // 10 requests/second

  // ============ AUTHENTICATION ============
  // Login/token refresh attempts per IP
  auth: { max: 10, window: 60 },                   // 10 requests/minute
  // Failed login tracking
  authFailed: { max: 5, window: 900 },             // 5 failed/15min → delay

  // ============ PIN SECURITY ============
  // PIN verification attempts
  pinAttempts: { max: 5, window: 900 },            // 5 attempts/15 minutes
  // Progressive lockout durations (seconds): 15min, 1hr, 6hr, 24hr
  pinLockoutDurations: [900, 3600, 21600, 86400],
  // PIN change limit
  pinChange: { max: 3, window: 86400 },            // 3 changes/day

  // ============ EMAIL VERIFICATION ============
  // Send verification code (per user)
  emailSend: { max: 3, window: 3600 },             // 3 emails/hour per user
  // Send verification code (per email address)
  emailDaily: { max: 5, window: 86400 },           // 5 codes/day per email
  // Send verification code (per IP)
  emailIp: { max: 10, window: 3600 },              // 10 emails/hour per IP
  // Verify code attempts (per code)
  emailVerify: { max: 5, window: 600 },            // 5 attempts/10min per code
  // Resend cooldown
  emailResendCooldown: 60,                         // 60 seconds between resends
  // Code validity duration
  emailCodeValidity: 300,                          // 5 minutes (production)
  emailCodeValidityDev: 86400,                     // 24 hours (dev mode)
  // Email change limit
  emailChange: { max: 2, window: 86400 },          // 2 changes/day

  // ============ RECOVERY ============
  // Recovery code usage attempts
  recovery: { max: 3, window: 3600 },              // 3 attempts/hour
  // Recovery code generation
  recoveryGenerate: { max: 2, window: 86400 },     // 2 generations/day

  // ============ WALLET CREATION (Anti-Abuse) ============
  // Wallet creation per IP
  walletCreateIp: { max: 5, window: 86400 },       // 5 wallets/day per IP
  // Wallet creation per device fingerprint
  walletCreateDevice: { max: 3, window: 86400 },   // 3 wallets/day per device

  // ============ SENSITIVE OPERATIONS ============
  // Export private key/recovery phrase
  exportKey: { max: 2, window: 3600 },             // 2 exports/hour
  // Session/device management
  sessionManage: { max: 10, window: 3600 },        // 10 actions/hour

  // ============ SESSION ============
  // Heartbeat/polling (high frequency allowed)
  sessionHeartbeat: { max: 120, window: 60 },      // 120 heartbeats/minute
  // Concurrent sessions per user
  maxConcurrentSessions: 5,

  // ============ BOT COMMANDS ============
  commands: { max: 30, window: 60 },               // 30 commands/minute

  // ============ TRANSACTIONS ============
  // Will be configured separately when needed
  transactions: { max: 10, window: 60 },           // Placeholder
} as const;

/**
 * Suspicious Activity Thresholds
 * Triggers alerts/notifications when exceeded
 */
export const SUSPICIOUS_ACTIVITY = {
  // PIN failures before alert
  pinFailuresAlert: 3,
  // Failed logins before alert
  loginFailuresAlert: 5,
  // New device login → email notification
  newDeviceAlert: true,
  // Different country login → email notification
  geoChangeAlert: true,
  // Large transfer threshold (CC amount)
  largeTransferThreshold: 1000,
  // Night hours for extra scrutiny (UTC)
  nightHoursStart: 0,  // 00:00 UTC
  nightHoursEnd: 6,    // 06:00 UTC
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
  swapRefund: 'swap-refund',
  bridgePolling: 'bridge-polling',
  treasuryMonitor: 'treasury-monitor',
} as const;

export const UTXO_MERGE_CONFIG = {
  maxUtxos: 10, // Merge when UTXO count exceeds this
  checkIntervalMs: 5 * 60 * 1000, // Check every 5 minutes
} as const;

export const CANTON_SYNC_CONFIG = {
  checkIntervalMs: 2 * 60 * 1000, // Sync every 2 minutes
} as const;

export const SWAP_REFUND_CONFIG = {
  checkIntervalMs: 1 * 60 * 1000, // Check every 1 minute
  maxRetries: 5, // Maximum refund retry attempts
  maxAgeMinutes: 60, // Stop retrying after 60 minutes
} as const;

export const BRIDGE_POLLING_CONFIG = {
  checkIntervalMs: 30 * 1000, // Poll every 30 seconds
  maxRetries: 120, // ~1 hour of retries at 30s intervals
  maxAgeHours: 24, // Stop retrying after 24 hours
  ethConfirmationsRequired: 12, // Required Ethereum confirmations
} as const;

export const TREASURY_MONITOR_CONFIG = {
  checkIntervalMs: 5 * 60 * 1000, // Check every 5 minutes
  lowBalanceThresholdCc: 100, // Alert when CC < 100
  lowBalanceThresholdUsdcx: 100, // Alert when USDCx < 100
  criticalThreshold: 10, // Critical when balance < 10
} as const;
