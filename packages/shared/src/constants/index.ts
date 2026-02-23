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
