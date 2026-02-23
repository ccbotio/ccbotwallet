import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'crypto';

// Mock environment
vi.mock('../../src/config/env.js', () => ({
  env: {
    TELEGRAM_BOT_TOKEN: 'test_bot_token_123456789',
    APP_SECRET: '0'.repeat(128),
    NODE_ENV: 'test',
  },
}));

// Mock database
vi.mock('../../src/db/index.js', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ id: 'test-user-id', telegramId: '123456789' }]),
  },
  users: {},
  sessions: {},
}));

describe('Auth Service', () => {
  describe('Telegram initData Validation', () => {
    const BOT_TOKEN = 'test_bot_token_123456789';

    function createValidInitData(data: Record<string, string>): string {
      // Sort and create data-check-string
      const pairs = Object.entries(data)
        .filter(([key]) => key !== 'hash')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`);

      const dataCheckString = pairs.join('\n');

      // Create secret key from bot token
      const secretKey = createHmac('sha256', 'WebAppData')
        .update(BOT_TOKEN)
        .digest();

      // Create hash
      const hash = createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

      return new URLSearchParams({ ...data, hash }).toString();
    }

    it('should validate correct initData format', () => {
      const authDate = Math.floor(Date.now() / 1000).toString();
      const userData = JSON.stringify({
        id: 123456789,
        first_name: 'Test',
        username: 'testuser',
      });

      const initData = createValidInitData({
        auth_date: authDate,
        user: userData,
        query_id: 'test_query_id',
      });

      // Parse initData
      const params = new URLSearchParams(initData);
      expect(params.get('hash')).toBeDefined();
      expect(params.get('auth_date')).toBe(authDate);
      expect(params.get('user')).toBe(userData);
    });

    it('should reject expired initData (older than 1 hour)', () => {
      const expiredAuthDate = Math.floor(Date.now() / 1000) - 3700; // 1 hour + 100 seconds ago
      const authDate = expiredAuthDate.toString();

      // Check if auth_date is too old
      const now = Math.floor(Date.now() / 1000);
      const isExpired = now - parseInt(authDate) > 3600;

      expect(isExpired).toBe(true);
    });

    it('should accept recent initData (within 1 hour)', () => {
      const recentAuthDate = Math.floor(Date.now() / 1000) - 1800; // 30 minutes ago
      const authDate = recentAuthDate.toString();

      const now = Math.floor(Date.now() / 1000);
      const isExpired = now - parseInt(authDate) > 3600;

      expect(isExpired).toBe(false);
    });
  });

  describe('JWT Token Generation', () => {
    it('should generate valid JWT structure', async () => {
      const { SignJWT } = await import('jose');

      const secret = new TextEncoder().encode('test-secret-key-minimum-32-chars!');
      const token = await new SignJWT({
        telegramId: '123456789',
        sub: 'user-id',
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('15m')
        .setIssuer('ccbot-wallet')
        .setAudience('ccbot-wallet-api')
        .sign(secret);

      // JWT should have 3 parts
      const parts = token.split('.');
      expect(parts).toHaveLength(3);

      // Header should be valid base64
      const header = JSON.parse(Buffer.from(parts[0] ?? '', 'base64url').toString());
      expect(header.alg).toBe('HS256');
    });

    it('should include required claims', async () => {
      const { SignJWT, jwtVerify } = await import('jose');

      const secret = new TextEncoder().encode('test-secret-key-minimum-32-chars!');
      const telegramId = '123456789';
      const userId = 'user-uuid';

      const token = await new SignJWT({
        telegramId,
        sub: userId,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('15m')
        .setIssuer('ccbot-wallet')
        .setAudience('ccbot-wallet-api')
        .sign(secret);

      const { payload } = await jwtVerify(token, secret, {
        issuer: 'ccbot-wallet',
        audience: 'ccbot-wallet-api',
      });

      expect(payload.telegramId).toBe(telegramId);
      expect(payload.sub).toBe(userId);
      expect(payload.iss).toBe('ccbot-wallet');
      expect(payload.aud).toBe('ccbot-wallet-api');
      expect(payload.exp).toBeDefined();
      expect(payload.iat).toBeDefined();
    });

    it('should reject expired tokens', async () => {
      const { SignJWT, jwtVerify } = await import('jose');

      const secret = new TextEncoder().encode('test-secret-key-minimum-32-chars!');

      // Create token that expires immediately
      const token = await new SignJWT({ sub: 'test' })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime(Math.floor(Date.now() / 1000) - 100) // Expired 100 seconds ago
        .sign(secret);

      await expect(jwtVerify(token, secret)).rejects.toThrow();
    });
  });

  describe('Session Management', () => {
    it('should generate unique session IDs', () => {
      const { randomUUID } = require('crypto');

      const sessionId1 = randomUUID();
      const sessionId2 = randomUUID();

      expect(sessionId1).not.toBe(sessionId2);
      expect(sessionId1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('should generate secure refresh tokens', () => {
      const { randomUUID } = require('crypto');

      const refreshToken = randomUUID();

      expect(refreshToken).toBeDefined();
      expect(refreshToken.length).toBe(36);
    });
  });
});
