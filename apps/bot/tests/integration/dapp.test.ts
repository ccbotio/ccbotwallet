/**
 * Integration Tests for dApp API Routes
 *
 * Tests the CIP-103 dApp API endpoints including:
 * - Session creation
 * - Session approval/rejection
 * - Status checking with PKCE
 * - Connection management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash, randomBytes } from 'crypto';

// Create chainable mock for db - must be hoisted for vi.mock to access it
const { mockDb, resetMockDb } = vi.hoisted(() => {
  // Use a proxy-based approach for proper chaining
  const createMock = () => {
    const mock: Record<string, ReturnType<typeof vi.fn>> = {
      insert: vi.fn(),
      values: vi.fn(),
      returning: vi.fn(),
      select: vi.fn(),
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
      update: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    };

    // Chain methods return mock
    mock.insert.mockReturnValue(mock);
    mock.values.mockReturnValue(mock);
    mock.returning.mockResolvedValue([{ id: 'test-id', sessionId: 'test-session' }]);
    mock.select.mockReturnValue(mock);
    mock.from.mockReturnValue(mock);
    mock.where.mockReturnValue(mock);
    mock.limit.mockResolvedValue([]);
    mock.update.mockReturnValue(mock);
    mock.set.mockReturnValue(mock);
    mock.delete.mockReturnValue(mock);

    return mock;
  };

  const mock = createMock();

  const resetMock = () => {
    // Restore chain behavior and default values
    mock.insert.mockReturnValue(mock);
    mock.values.mockReturnValue(mock);
    mock.returning.mockResolvedValue([{ id: 'test-id', sessionId: 'test-session' }]);
    mock.select.mockReturnValue(mock);
    mock.from.mockReturnValue(mock);
    mock.where.mockReturnValue(mock);
    mock.limit.mockResolvedValue([]);
    mock.update.mockReturnValue(mock);
    mock.set.mockReturnValue(mock);
    mock.delete.mockReturnValue(mock);
  };

  return {
    mockDb: mock,
    resetMockDb: resetMock
  };
});

// Mock the database
vi.mock('../../src/db/index.js', () => ({
  db: mockDb,
}));

// Mock schema
vi.mock('../../src/db/schema.js', () => ({
  dappSessions: {},
  dappConnections: {},
  wallets: {},
  serverShares: {},
  users: {},
}));

// Mock the env
vi.mock('../../src/config/env.js', () => ({
  env: {
    MINI_APP_URL: 'https://t.me/CCBotWallet',
    TELEGRAM_MINI_APP_URL: 'https://t.me/CCBotWallet',
    ENCRYPTION_KEY: '0'.repeat(64),
    CANTON_NETWORK: 'devnet',
    CANTON_PARTICIPANT_ID: 'test-participant',
    CANTON_VALIDATOR_API_URL: 'https://validator.test.com',
    JWT_SECRET: 'test-jwt-secret-12345678901234567890',
  },
}));

// Mock crypto
vi.mock('@repo/crypto', () => ({
  shareFromHex: vi.fn().mockReturnValue({ index: 1, value: Buffer.alloc(32) }),
  withReconstructedKey: vi.fn().mockImplementation(async (_shares, fn) => {
    return fn('0'.repeat(64));
  }),
  ed25519Sign: vi.fn().mockReturnValue(Buffer.alloc(64)),
  hexToBytes: vi.fn().mockReturnValue(Buffer.alloc(32)),
  bytesToHex: vi.fn().mockReturnValue('0'.repeat(128)),
}));

vi.mock('@repo/crypto/encryption', () => ({
  decrypt: vi.fn().mockReturnValue('0'.repeat(128)),
}));

// Import the service after mocks
import { DappSessionService } from '../../src/services/dapp-session/index.js';

// Helper to generate PKCE codes
function generatePKCE() {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

describe('dApp API Integration Tests', () => {
  let service: DappSessionService;

  beforeEach(() => {
    // Reset mock chain before each test
    resetMockDb();
    service = new DappSessionService();
  });

  afterEach(() => {
    // Don't use resetAllMocks as it breaks mock chain
  });

  describe('POST /api/dapp/session', () => {
    it('should create session and return wallet URL', async () => {
      const { codeChallenge } = generatePKCE();

      const result = await service.createSession({
        method: 'connect',
        origin: 'https://example-dapp.com',
        name: 'Example dApp',
        callbackUrl: 'https://example-dapp.com/callback',
        codeChallenge,
      });

      expect(result.sessionId).toBeDefined();
      expect(result.sessionId.length).toBeGreaterThan(20);
      expect(result.walletUrl).toContain('approve?session=');
      expect(result.walletUrl).toContain(result.sessionId);
      expect(result.expiresAt).toBeInstanceOf(Date);

      // Verify DB insert was called
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should reject invalid method', async () => {
      await expect(
        service.createSession({
          method: 'invalidMethod' as never,
          origin: 'https://example.com',
          callbackUrl: 'https://example.com/callback',
          codeChallenge: 'test',
        })
      ).rejects.toThrow();
    });

    it('should accept optional parameters', async () => {
      const { codeChallenge } = generatePKCE();

      const result = await service.createSession({
        method: 'connect',
        origin: 'https://example.com',
        name: 'Test App',
        icon: 'https://example.com/icon.png',
        callbackUrl: 'https://example.com/callback',
        codeChallenge,
        requestId: 'req-123',
        ipAddress: '127.0.0.1',
        userAgent: 'TestClient/1.0',
      });

      expect(result.sessionId).toBeDefined();
    });

    it('should handle signMessage method with params', async () => {
      const { codeChallenge } = generatePKCE();

      const result = await service.createSession({
        method: 'signMessage',
        params: {
          message: 'Hello, Canton!',
          encoding: 'utf8',
        },
        origin: 'https://example.com',
        callbackUrl: 'https://example.com/callback',
        codeChallenge,
      });

      expect(result.sessionId).toBeDefined();
    });
  });

  describe('POST /api/dapp/session/:id/approve', () => {
    it('should require valid session', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      const result = await service.approveSession(
        'non-existent-session',
        'user-id',
        'wallet-id',
        'party-id'
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(-32002); // SESSION_NOT_FOUND
    });

    it('should require PIN for signing methods', async () => {
      const mockSession = {
        sessionId: 'test-session',
        method: 'signMessage',
        params: { message: 'test' },
        dappOrigin: 'https://example.com',
        callbackUrl: 'https://example.com/callback',
        requestId: '1',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60000),
      };

      mockDb.limit.mockResolvedValueOnce([mockSession]);

      const result = await service.approveSession(
        'test-session',
        'user-id',
        'wallet-id',
        'party-id'
        // Missing userShareHex
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(4100); // UNAUTHORIZED
      expect(result.error?.message).toContain('User share required');
    });

    it('should create connection on connect', async () => {
      const mockSession = {
        sessionId: 'test-session',
        method: 'connect',
        params: null,
        dappOrigin: 'https://example.com',
        dappName: 'Test dApp',
        callbackUrl: 'https://example.com/callback',
        requestId: '1',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60000),
      };

      mockDb.limit
        .mockResolvedValueOnce([mockSession]) // Get session
        .mockResolvedValueOnce([]) // Check existing connection
        .mockResolvedValueOnce([{ id: 'wallet-id', partyId: 'party-id', publicKey: 'key' }]); // Get wallet

      const result = await service.approveSession(
        'test-session',
        'user-id',
        'wallet-id',
        'party-id'
      );

      expect(result.success).toBe(true);
      expect(result.redirectUrl).toBeDefined();
      expect(mockDb.insert).toHaveBeenCalled(); // Connection created
    });
  });

  describe('POST /api/dapp/session/:id/reject', () => {
    it('should reject session successfully', async () => {
      const mockSession = {
        sessionId: 'test-session',
        method: 'connect',
        callbackUrl: 'https://example.com/callback',
        requestId: '1',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60000),
      };

      mockDb.limit.mockResolvedValueOnce([mockSession]);

      const result = await service.rejectSession('test-session');

      expect(result.success).toBe(true);
      expect(result.redirectUrl).toContain('callback');

      // Verify redirect URL contains error
      const url = new URL(result.redirectUrl);
      const response = JSON.parse(
        Buffer.from(url.searchParams.get('response')!, 'base64url').toString()
      );
      expect(response.error.code).toBe(4001); // USER_REJECTED
    });

    it('should throw for expired session', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      await expect(service.rejectSession('expired-session')).rejects.toThrow(
        'Session not found or expired'
      );
    });
  });

  describe('POST /api/dapp/session/:id/status', () => {
    it('should verify PKCE', async () => {
      const { codeVerifier, codeChallenge } = generatePKCE();

      const mockSession = {
        sessionId: 'test-session',
        codeChallenge,
        status: 'pending',
        result: null,
        errorCode: null,
        errorMessage: null,
        expiresAt: new Date(Date.now() + 60000),
      };

      mockDb.limit.mockResolvedValueOnce([mockSession]);

      const result = await service.checkSessionStatus('test-session', codeVerifier);

      expect(result.status).toBe('pending');
      expect(result.error).toBeUndefined();
    });

    it('should reject invalid PKCE verifier', async () => {
      const { codeChallenge } = generatePKCE();

      const mockSession = {
        sessionId: 'test-session',
        codeChallenge,
        status: 'pending',
        expiresAt: new Date(Date.now() + 60000),
      };

      mockDb.limit.mockResolvedValueOnce([mockSession]);

      const result = await service.checkSessionStatus(
        'test-session',
        'wrong-verifier-that-wont-match'
      );

      expect(result.status).toBe('expired'); // Returns expired on PKCE failure
      expect(result.error?.code).toBe(-32006); // PKCE_VERIFICATION_FAILED
    });

    it('should return completed with result', async () => {
      const { codeVerifier, codeChallenge } = generatePKCE();

      const mockSession = {
        sessionId: 'test-session',
        codeChallenge,
        status: 'completed',
        result: { connected: true, accounts: [{ partyId: 'party-1' }] },
        errorCode: null,
        errorMessage: null,
        expiresAt: new Date(Date.now() + 60000),
      };

      mockDb.limit.mockResolvedValueOnce([mockSession]);

      const result = await service.checkSessionStatus('test-session', codeVerifier);

      expect(result.status).toBe('completed');
      expect(result.result).toEqual({ connected: true, accounts: [{ partyId: 'party-1' }] });
    });

    it('should return rejected with error', async () => {
      const { codeVerifier, codeChallenge } = generatePKCE();

      const mockSession = {
        sessionId: 'test-session',
        codeChallenge,
        status: 'rejected',
        result: null,
        errorCode: 4001,
        errorMessage: 'User rejected the request',
        expiresAt: new Date(Date.now() + 60000),
      };

      mockDb.limit.mockResolvedValueOnce([mockSession]);

      const result = await service.checkSessionStatus('test-session', codeVerifier);

      expect(result.status).toBe('rejected');
      expect(result.error?.code).toBe(4001);
      expect(result.error?.message).toBe('User rejected the request');
    });

    it('should return expired for non-existent session', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      const result = await service.checkSessionStatus('non-existent', 'any-verifier');

      expect(result.status).toBe('expired');
    });
  });

  describe('Connection management', () => {
    it('should disconnect dApp', async () => {
      mockDb.where.mockResolvedValueOnce({ rowCount: 1 });

      const result = await service.disconnectDapp('conn-id', 'user-id');

      expect(result).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should return false for non-existent connection', async () => {
      mockDb.where.mockResolvedValueOnce({ rowCount: 0 });

      const result = await service.disconnectDapp('non-existent', 'user-id');

      expect(result).toBe(false);
    });
  });

  describe('Session expiry', () => {
    it('should set 15 minute expiry', async () => {
      const { codeChallenge } = generatePKCE();
      const beforeCreate = Date.now();

      const result = await service.createSession({
        method: 'connect',
        origin: 'https://example.com',
        callbackUrl: 'https://example.com/callback',
        codeChallenge,
      });

      const expiryTime = result.expiresAt.getTime();
      const expectedExpiry = beforeCreate + 15 * 60 * 1000;

      // Allow 2 second tolerance for test execution time
      expect(expiryTime).toBeGreaterThan(expectedExpiry - 2000);
      expect(expiryTime).toBeLessThan(expectedExpiry + 2000);
    });
  });

  describe('Cleanup', () => {
    it('should cleanup expired sessions', async () => {
      mockDb.where.mockResolvedValueOnce({ rowCount: 10 });

      const deleted = await service.cleanupExpiredSessions();

      expect(deleted).toBe(10);
      expect(mockDb.delete).toHaveBeenCalled();
    });
  });
});
