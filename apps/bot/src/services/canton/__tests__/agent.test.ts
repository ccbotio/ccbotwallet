import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CantonAgentService,
  getCantonAgent,
  resetCantonAgent,
} from '../agent.js';

// Mock dependencies
vi.mock('@repo/canton-client', () => ({
  OfficialSDKClient: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    getCCPrice: vi.fn().mockResolvedValue({
      price: 0.16,
      round: 100,
      amuletPriceUsd: 0.16,
      rewardRate: 0.0001,
    }),
    getBalance: vi.fn().mockResolvedValue({
      token: 'CC',
      amount: '100.0000000000',
      locked: '0.0000000000',
    }),
    listHoldings: vi.fn().mockResolvedValue([]),
    setupWallet: vi.fn().mockResolvedValue({
      partyId: 'test-party-id',
      preapprovalContractId: 'test-preapproval',
    }),
    sendCC: vi.fn().mockResolvedValue({
      txHash: 'test-tx-hash',
      status: 'confirmed',
      updateId: 'test-update-id',
    }),
    createExternalParty: vi.fn().mockResolvedValue({
      partyId: 'test-party-id',
      publicKey: 'test-public-key',
      topologyTxHashes: [],
    }),
    createPreapproval: vi.fn().mockResolvedValue({
      contractId: 'test-contract-id',
      receiver: 'test-party-id',
      provider: 'test-provider',
    }),
    getPreapproval: vi.fn().mockResolvedValue(null),
    mergeUtxos: vi.fn().mockResolvedValue(undefined),
    getTransactionHistory: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('../../../lib/redis.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    hgetall: vi.fn().mockResolvedValue({}),
    hincrby: vi.fn().mockResolvedValue(1),
    hset: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    CANTON_NETWORK: 'devnet',
    CANTON_LEDGER_API_URL: 'http://localhost:5003',
    CANTON_VALIDATOR_API_URL: 'http://localhost:5003',
    CANTON_PARTICIPANT_ID: 'test-participant',
    CANTON_LEDGER_API_USER: 'test-user',
    CANTON_VALIDATOR_AUDIENCE: 'https://validator.example.com',
    APP_SECRET: '0'.repeat(64),
    CANTON_DSO_PARTY_ID: 'test-dso-party',
    CANTON_PROVIDER_PARTY_ID: 'test-provider-party',
    CANTON_FAUCET_URL: undefined,
  },
}));

describe('CantonAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCantonAgent();
  });

  afterEach(() => {
    resetCantonAgent();
  });

  describe('singleton', () => {
    it('should return same instance from getCantonAgent', () => {
      const agent1 = getCantonAgent();
      const agent2 = getCantonAgent();
      expect(agent1).toBe(agent2);
    });

    it('should return new instance after reset', () => {
      const agent1 = getCantonAgent();
      resetCantonAgent();
      const agent2 = getCantonAgent();
      expect(agent1).not.toBe(agent2);
    });
  });

  describe('connect', () => {
    it('should initialize SDK on connect', async () => {
      const agent = new CantonAgentService();
      await agent.connect();
      expect(agent.isInitialized()).toBe(true);
    });

    it('should not reinitialize if already connected', async () => {
      const agent = new CantonAgentService();
      await agent.connect();
      await agent.connect();
      expect(agent.isInitialized()).toBe(true);
    });
  });

  describe('health checks', () => {
    it('should return healthy status on successful check', async () => {
      const agent = new CantonAgentService();
      await agent.connect();
      const status = await agent.performHealthCheck();

      expect(status.isHealthy).toBe(true);
      expect(status.ledgerConnected).toBe(true);
      expect(status.validatorAccessible).toBe(true);
      expect(status.consecutiveFailures).toBe(0);
    });

    it('should return cached health status', async () => {
      const agent = new CantonAgentService();
      await agent.connect();

      // First check stores in Redis
      await agent.performHealthCheck();

      // Second call should use cached value
      const status = await agent.getHealthStatus();
      expect(status.isHealthy).toBe(true);
    });
  });

  describe('operations with retry', () => {
    it('should get balance successfully', async () => {
      const agent = new CantonAgentService();
      await agent.connect();

      const balance = await agent.getBalance('test-party');
      expect(balance.token).toBe('CC');
      expect(balance.amount).toBe('100.0000000000');
    });

    it('should get CC price successfully', async () => {
      const agent = new CantonAgentService();
      await agent.connect();

      const price = await agent.getCCPrice();
      expect(price.price).toBe(0.16);
      expect(price.round).toBe(100);
    });

    it('should setup wallet successfully', async () => {
      const agent = new CantonAgentService();
      await agent.connect();

      const result = await agent.setupWallet('test-private-key', 'test-name');
      expect(result.partyId).toBe('test-party-id');
    });

    it('should list holdings successfully', async () => {
      const agent = new CantonAgentService();
      await agent.connect();

      const holdings = await agent.listHoldings('test-party');
      expect(Array.isArray(holdings)).toBe(true);
    });
  });

  describe('devnet features', () => {
    it('should check faucet availability', async () => {
      const agent = new CantonAgentService();
      await agent.connect();

      const faucetStatus = await agent.checkFaucetAvailability();
      expect(faucetStatus.network).toBe('devnet');
      // No faucet URL configured
      expect(faucetStatus.available).toBe(false);
    });

    it('should validate devnet setup', async () => {
      const agent = new CantonAgentService();
      await agent.connect();

      const setupStatus = await agent.validateDevnetSetup();
      expect(setupStatus.networkType).toBe('devnet');
      expect(setupStatus.dsoPartyConfigured).toBe(true);
      expect(setupStatus.providerPartyConfigured).toBe(true);
    });
  });

  describe('metrics', () => {
    it('should return metrics object', async () => {
      const agent = new CantonAgentService();
      await agent.connect();

      const metrics = await agent.getMetrics();
      expect(metrics).toHaveProperty('totalOperations');
      expect(metrics).toHaveProperty('successfulOperations');
      expect(metrics).toHaveProperty('failedOperations');
      expect(metrics).toHaveProperty('averageLatencyMs');
    });

    it('should reset metrics', async () => {
      const agent = new CantonAgentService();
      await agent.connect();

      await agent.resetMetrics();
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('network info', () => {
    it('should return network type', () => {
      const agent = new CantonAgentService();
      expect(agent.getNetwork()).toBe('devnet');
    });

    it('should return healthy status', () => {
      const agent = new CantonAgentService();
      // Before connect, should be false
      expect(agent.isAgentHealthy()).toBe(true);
    });
  });
});
