/**
 * Test Mocks for E2E Testing
 */
import { vi } from 'vitest';

// Mock Canton SDK
export function createMockSDK() {
  return {
    getCCPrice: vi.fn().mockResolvedValue({ amuletPriceUsd: 0.16 }),
    getBalance: vi.fn().mockResolvedValue({ available: '1000', locked: '0' }),
    getAllBalances: vi.fn().mockResolvedValue([
      { token: 'CC', available: '1000', locked: '0' },
      { token: 'USDCx', available: '500', locked: '0' },
    ]),
    sendToken: vi.fn().mockResolvedValue({ txHash: 'mock-tx-hash-123' }),
    createTransfer: vi.fn().mockResolvedValue({ txHash: 'mock-tx-hash-456' }),
  };
}

// Mock Treasury Service
export function createMockTreasury() {
  return {
    isConfigured: vi.fn().mockReturnValue(true),
    getPartyId: vi.fn().mockReturnValue('treasury-party-id'),
    getPrivateKey: vi.fn().mockReturnValue('0'.repeat(64)),
    getBalance: vi.fn().mockResolvedValue({ cc: '10000', usdcx: '5000' }),
    sendToUser: vi.fn().mockResolvedValue({ success: true, txHash: 'treasury-tx-123' }),
  };
}

// Mock Redis Client
export function createMockRedis() {
  const store = new Map<string, string>();
  
  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) || null)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    incr: vi.fn((key: string) => {
      const current = parseInt(store.get(key) || '0', 10);
      store.set(key, String(current + 1));
      return Promise.resolve(current + 1);
    }),
    expire: vi.fn().mockResolvedValue(1),
    del: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve(1);
    }),
    clear: () => store.clear(),
  };
}

// Mock Telegram Bot
export function createMockBot() {
  return {
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 123 }),
    },
  };
}

// Mock Database
export function createMockDb() {
  const swapQuotes = new Map();
  const swapTransactions = new Map();
  
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    _swapQuotes: swapQuotes,
    _swapTransactions: swapTransactions,
  };
}

// Test data generators
export function generateSwapQuote(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: 'quote-' + now,
    userId: 'test-user-id',
    fromToken: 'CC',
    toToken: 'USDCx',
    fromAmount: '100',
    toAmount: '16',
    rate: '0.16',
    fee: '0.1',
    feePercentage: '0.1',
    ccPriceUsd: '0.16',
    priceImpact: '0',
    expiresAt: new Date(now + 60000),
    createdAt: new Date(),
    ...overrides,
  };
}

export function generateSwapTransaction(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    id: 'swap-' + now,
    quoteId: 'quote-' + now,
    userId: 'test-user-id',
    userPartyId: 'user-party-id',
    fromToken: 'CC',
    toToken: 'USDCx',
    fromAmount: '100',
    toAmount: '16',
    rate: '0.16',
    fee: '0.1',
    status: 'pending',
    createdAt: new Date(),
    ...overrides,
  };
}
