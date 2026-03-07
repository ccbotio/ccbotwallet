/**
 * Unit Tests for DappSessionService
 *
 * Tests CIP-103 dApp session management including:
 * - Session creation and expiry
 * - PKCE verification
 * - Method execution
 * - Connection management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';

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
  },
}));

// Mock crypto module
vi.mock('@repo/crypto', () => ({
  shareFromHex: vi.fn().mockReturnValue({ index: 1, value: Buffer.alloc(32) }),
  withReconstructedKey: vi.fn().mockImplementation(async (_shares, fn) => {
    return fn('0'.repeat(64));
  }),
  ed25519Sign: vi.fn().mockReturnValue(Buffer.alloc(64)),
  hexToBytes: vi.fn().mockReturnValue(Buffer.alloc(32)),
  bytesToHex: vi.fn().mockReturnValue('0'.repeat(128)),
}));

// Mock encryption
vi.mock('@repo/crypto/encryption', () => ({
  decrypt: vi.fn().mockReturnValue('0'.repeat(128)),
}));

// Import after mocks
import { DappSessionService } from '../../src/services/dapp-session/index.js';

describe('DappSessionService', () => {
  let service: DappSessionService;

  beforeEach(() => {
    // Reset mock chain before each test
    resetMockDb();
    service = new DappSessionService();
  });

  afterEach(() => {
    // Don't use resetAllMocks as it breaks mock chain
  });

  describe('createSession', () => {
    it('should create a session with valid params', async () => {
      const result = await service.createSession({
        method: 'connect',
        origin: 'https://example.com',
        name: 'Example dApp',
        callbackUrl: 'https://example.com/callback',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      });

      expect(result.sessionId).toBeDefined();
      expect(result.walletUrl).toContain('approve?session=');
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should set 15-minute expiry', async () => {
      const beforeCreate = Date.now();

      const result = await service.createSession({
        method: 'connect',
        origin: 'https://example.com',
        callbackUrl: 'https://example.com/callback',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      });

      const expiryTime = result.expiresAt.getTime();
      const expectedExpiry = beforeCreate + 15 * 60 * 1000;

      // Allow 1 second tolerance
      expect(expiryTime).toBeGreaterThan(expectedExpiry - 1000);
      expect(expiryTime).toBeLessThan(expectedExpiry + 2000);
    });

    it('should reject invalid method', async () => {
      await expect(
        service.createSession({
          method: 'invalidMethod' as never,
          origin: 'https://example.com',
          callbackUrl: 'https://example.com/callback',
          codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        })
      ).rejects.toThrow();
    });

    it('should include requestId in session', async () => {
      await service.createSession({
        method: 'connect',
        origin: 'https://example.com',
        callbackUrl: 'https://example.com/callback',
        codeChallenge: 'test-challenge',
        requestId: 'test-request-id',
      });

      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('getSession', () => {
    it('should return session data when found', async () => {
      const mockSession = {
        sessionId: 'test-session',
        method: 'connect',
        params: null,
        dappOrigin: 'https://example.com',
        dappName: 'Test dApp',
        dappIcon: null,
        status: 'pending',
        expiresAt: new Date(Date.now() + 60000),
        createdAt: new Date(),
      };

      mockDb.limit.mockResolvedValueOnce([mockSession]);

      const result = await service.getSession('test-session');

      expect(result).not.toBeNull();
      expect(result?.sessionId).toBe('test-session');
      expect(result?.method).toBe('connect');
      expect(result?.status).toBe('pending');
    });

    it('should return null for expired session', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      const result = await service.getSession('expired-session');

      expect(result).toBeNull();
    });

    it('should return null for non-existent session', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      const result = await service.getSession('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('approveSession', () => {
    it('should return error for non-existent session', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      const result = await service.approveSession(
        'non-existent',
        'user-id',
        'wallet-id',
        'party-id'
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe(-32002); // SESSION_NOT_FOUND
    });

    it('should require user share for signing methods', async () => {
      const mockSession = {
        sessionId: 'test-session',
        method: 'signMessage',
        params: { message: 'test' },
        dappOrigin: 'https://example.com',
        dappName: 'Test dApp',
        callbackUrl: 'https://example.com/callback',
        requestId: null,
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
    });

    it('should process connect method', async () => {
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

      // First call: get session
      // Second call: check existing connection
      // Third call: get wallet
      mockDb.limit
        .mockResolvedValueOnce([mockSession])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'wallet-id', partyId: 'party-id', publicKey: 'pubkey' }]);

      const result = await service.approveSession(
        'test-session',
        'user-id',
        'wallet-id',
        'party-id'
      );

      expect(result.success).toBe(true);
      expect(result.redirectUrl).toContain('callback');
    });
  });

  describe('rejectSession', () => {
    it('should set USER_REJECTED error code', async () => {
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

      // Verify the redirect URL contains the error
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

  describe('checkSessionStatus', () => {
    it('should verify PKCE correctly', async () => {
      // Generate valid code_verifier and code_challenge
      const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const codeChallenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

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

    it('should reject invalid code_verifier', async () => {
      const mockSession = {
        sessionId: 'test-session',
        codeChallenge: 'valid-challenge',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60000),
      };

      mockDb.limit.mockResolvedValueOnce([mockSession]);

      const result = await service.checkSessionStatus('test-session', 'wrong-verifier');

      expect(result.status).toBe('expired');
      expect(result.error?.code).toBe(-32006); // PKCE_VERIFICATION_FAILED
    });

    it('should return completed status with result', async () => {
      const codeVerifier = 'test-verifier-12345678901234567890123456789012345';
      const codeChallenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      const mockSession = {
        sessionId: 'test-session',
        codeChallenge,
        status: 'completed',
        result: { connected: true },
        errorCode: null,
        errorMessage: null,
        expiresAt: new Date(Date.now() + 60000),
      };

      mockDb.limit.mockResolvedValueOnce([mockSession]);

      const result = await service.checkSessionStatus('test-session', codeVerifier);

      expect(result.status).toBe('completed');
      expect(result.result).toEqual({ connected: true });
    });
  });

  describe('connection management', () => {
    it('should check connection correctly', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 'conn-id' }]);

      const isConnected = await service.checkConnection('user-id', 'https://example.com');

      expect(isConnected).toBe(true);
    });

    it('should return false for no connection', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      const isConnected = await service.checkConnection('user-id', 'https://example.com');

      expect(isConnected).toBe(false);
    });

    it('should create new connection', async () => {
      // No existing connection
      mockDb.limit.mockResolvedValueOnce([]);

      await service.createConnection(
        'user-id',
        'wallet-id',
        'https://example.com',
        'Test App',
        ['read']
      );

      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should reactivate existing connection', async () => {
      // Existing inactive connection
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 'conn-id',
          isActive: false,
        },
      ]);

      await service.createConnection(
        'user-id',
        'wallet-id',
        'https://example.com',
        'Test App'
      );

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should disconnect dApp', async () => {
      // Mock update to return affected rows
      mockDb.where.mockResolvedValueOnce({ rowCount: 1 });

      const result = await service.disconnectDapp('conn-id', 'user-id');

      expect(result).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('should delete expired pending sessions', async () => {
      mockDb.where.mockResolvedValueOnce({ rowCount: 5 });

      const deleted = await service.cleanupExpiredSessions();

      expect(deleted).toBe(5);
      expect(mockDb.delete).toHaveBeenCalled();
    });

    it('should return 0 when no sessions to cleanup', async () => {
      mockDb.where.mockResolvedValueOnce({ rowCount: 0 });

      const deleted = await service.cleanupExpiredSessions();

      expect(deleted).toBe(0);
    });
  });
});
