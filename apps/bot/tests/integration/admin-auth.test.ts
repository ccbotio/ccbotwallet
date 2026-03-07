/**
 * Admin Authentication Middleware Tests
 *
 * Tests the admin auth middleware:
 * - API key validation
 * - Production configuration checks
 * - Security logging
 * - Error responses
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Mock environment - must be defined before vi.mock
vi.mock('../../src/config/env.js', () => {
  return {
    env: {
      NODE_ENV: 'development',
      ADMIN_API_KEY: 'test-admin-key-32-chars-minimum!',
    },
  };
});

// Helper to create mock request
function createMockRequest(headers: Record<string, string> = {}): FastifyRequest {
  return {
    headers,
    ip: '127.0.0.1',
    url: '/api/admin/test',
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as unknown as FastifyRequest;
}

// Helper to create mock reply
function createMockReply() {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    sent: false,
  };
  return reply as unknown as FastifyReply;
}

describe('Admin Authentication Middleware', () => {
  let adminAuthMiddleware: typeof import('../../src/api/middleware/admin-auth.js').adminAuthMiddleware;
  let isAdminRequest: typeof import('../../src/api/middleware/admin-auth.js').isAdminRequest;
  let mockEnv: { NODE_ENV: string; ADMIN_API_KEY: string };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get the mocked env module
    const envModule = await import('../../src/config/env.js');
    mockEnv = envModule.env as { NODE_ENV: string; ADMIN_API_KEY: string };
    mockEnv.NODE_ENV = 'development';
    mockEnv.ADMIN_API_KEY = 'test-admin-key-32-chars-minimum!';

    // Import the middleware fresh for each test
    const authModule = await import('../../src/api/middleware/admin-auth.js');
    adminAuthMiddleware = authModule.adminAuthMiddleware;
    isAdminRequest = authModule.isAdminRequest;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('API Key Validation', () => {
    it('should reject requests without x-admin-key header', async () => {
      const request = createMockRequest({});
      const reply = createMockReply();

      await adminAuthMiddleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Admin API key required',
        code: 'ADMIN_AUTH_REQUIRED',
      });
    });

    it('should reject requests with invalid API key', async () => {
      const request = createMockRequest({
        'x-admin-key': 'wrong-key',
      });
      const reply = createMockReply();

      await adminAuthMiddleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid admin API key',
        code: 'ADMIN_AUTH_INVALID',
      });
    });

    it('should accept requests with valid API key', async () => {
      const request = createMockRequest({
        'x-admin-key': 'test-admin-key-32-chars-minimum!',
      });
      const reply = createMockReply();

      await adminAuthMiddleware(request, reply);

      // Should not send error response
      expect(reply.status).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();

      // Should mark request as admin
      expect(request.isAdmin).toBe(true);
    });

    it('should allow requests without API key when requireApiKey is false', async () => {
      const request = createMockRequest({});
      const reply = createMockReply();

      await adminAuthMiddleware(request, reply, { requireApiKey: false });

      expect(reply.status).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });
  });

  describe('Production Configuration', () => {
    it('should reject in production if ADMIN_API_KEY not set', async () => {
      mockEnv.NODE_ENV = 'production';
      mockEnv.ADMIN_API_KEY = '';

      const request = createMockRequest({
        'x-admin-key': 'some-key',
      });
      const reply = createMockReply();

      await adminAuthMiddleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(500);
      expect(reply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Server configuration error',
        code: 'ADMIN_CONFIG_ERROR',
      });
    });

    it('should reject in production if using default dev key', async () => {
      mockEnv.NODE_ENV = 'production';
      mockEnv.ADMIN_API_KEY = 'dev-admin-key';

      const request = createMockRequest({
        'x-admin-key': 'dev-admin-key',
      });
      const reply = createMockReply();

      await adminAuthMiddleware(request, reply);

      expect(reply.status).toHaveBeenCalledWith(500);
      expect(reply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Server configuration error',
        code: 'ADMIN_CONFIG_ERROR',
      });
    });
  });

  describe('Security Logging', () => {
    it('should log failed authentication attempts', async () => {
      const request = createMockRequest({
        'x-admin-key': 'wrong-key',
        'user-agent': 'test-agent',
      });
      const reply = createMockReply();

      await adminAuthMiddleware(request, reply);

      expect(request.log.warn).toHaveBeenCalledWith({
        event: 'admin_auth_failed',
        ip: '127.0.0.1',
        path: '/api/admin/test',
        userAgent: 'test-agent',
      });
    });

    it('should log successful authentication', async () => {
      const request = createMockRequest({
        'x-admin-key': 'test-admin-key-32-chars-minimum!',
      });
      const reply = createMockReply();

      await adminAuthMiddleware(request, reply);

      expect(request.log.info).toHaveBeenCalledWith({
        event: 'admin_auth_success',
        ip: '127.0.0.1',
        path: '/api/admin/test',
      });
    });

    it('should log missing API key attempts', async () => {
      const request = createMockRequest({});
      const reply = createMockReply();

      await adminAuthMiddleware(request, reply);

      expect(request.log.warn).toHaveBeenCalledWith({
        event: 'admin_auth_missing',
        ip: '127.0.0.1',
        path: '/api/admin/test',
      });
    });
  });

  describe('Helper Functions', () => {
    it('isAdminRequest should return true for authenticated requests', async () => {
      const request = createMockRequest({
        'x-admin-key': 'test-admin-key-32-chars-minimum!',
      });
      const reply = createMockReply();

      await adminAuthMiddleware(request, reply);

      expect(isAdminRequest(request)).toBe(true);
    });

    it('isAdminRequest should return false for unauthenticated requests', () => {
      const request = createMockRequest({});

      expect(isAdminRequest(request)).toBe(false);
    });
  });
});
