export const SUPPORTED_TOKENS = ['CC', 'USDC', 'ETH'] as const;
export type SupportedToken = (typeof SUPPORTED_TOKENS)[number];

export const USER_TIERS = {
  bronze: { dailyLimit: 100, monthlyLimit: 1000 },
  silver: { dailyLimit: 500, monthlyLimit: 5000 },
  gold: { dailyLimit: 2000, monthlyLimit: 20000 },
  platinum: { dailyLimit: 10000, monthlyLimit: 100000 },
} as const;

export const TRANSACTION_LIMITS = {
  minAmount: '0.000001',
  maxAmount: '1000000',
} as const;

export const VERIFICATION_EXPIRY_DAYS = {
  telegram_age: 365,
  botbasher: 30,
  x_account: 90,
} as const;

export const API_ENDPOINTS = {
  wallet: {
    balance: '/api/wallet/balance',
    transactions: '/api/wallet/transactions',
    send: '/api/wallet/send',
  },
  user: {
    profile: '/api/user/profile',
    verify: '/api/user/verify',
  },
} as const;

export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_INPUT: 'INVALID_INPUT',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  RATE_LIMITED: 'RATE_LIMITED',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  WALLET_NOT_FOUND: 'WALLET_NOT_FOUND',
} as const;

/**
 * Timeout values for Canton Network API operations.
 * Longer timeouts for operations that involve signing or topology changes.
 */
export const CANTON_TIMEOUTS = {
  /** Auth token acquisition - should be fast */
  auth: 10000,
  /** Balance queries */
  balance: 15000,
  /** Transfer operations (includes signing time) */
  transfer: 60000,
  /** Transaction history queries */
  history: 30000,
  /** Party creation (topology transactions) */
  party: 45000,
  /** Preapproval operations */
  preapproval: 30000,
  /** Ledger API queries */
  ledger: 15000,
  /** Default timeout for unspecified operations */
  default: 30000,
} as const;

/**
 * Retry configuration for Canton Network API operations.
 */
export const RETRY_CONFIG = {
  /** Maximum number of retry attempts */
  maxRetries: 3,
  /** Base delay for exponential backoff (ms) */
  backoffBase: 1000,
  /** Maximum backoff delay (ms) */
  backoffMax: 10000,
  /** HTTP status codes that trigger retry */
  retryableStatus: [408, 429, 500, 502, 503, 504],
} as const;

/**
 * Exchange rates for display purposes.
 * @deprecated Use real-time price from /api/price endpoints
 * Kept for backwards compatibility only
 */
export const EXCHANGE_RATES = {
  /** @deprecated Use getCCPrice() API instead */
  CC_TO_USD: 10,
} as const;

/**
 * Estimated network fees for display purposes.
 */
export const NETWORK_FEES = {
  /** Estimated transfer fee in CC */
  estimatedTransferFee: '0.001',
} as const;

/**
 * Price service configuration
 */
export const PRICE_CONFIG = {
  /** Fallback prices when API fails (USD) */
  FALLBACK: {
    /** CC fallback price in USD */
    CC_USD: '0.16',
    /** BTC fallback price in USD */
    BTC_USD: '97000',
  },
  /** Cache TTL in milliseconds */
  CACHE_TTL: {
    /** CC price cache duration */
    CC: 30000, // 30 seconds
    /** BTC price cache duration */
    BTC: 60000, // 60 seconds
  },
  /** Frontend polling interval in milliseconds */
  POLL_INTERVAL: 60000, // 60 seconds
  /** Price staleness threshold (5 minutes) */
  STALENESS_THRESHOLD_MS: 300000,
} as const;
