import { describe, it, expect } from 'vitest';
import { createHmac, randomBytes } from 'crypto';

describe('Cryptographic Utilities', () => {
  describe('HMAC-SHA256', () => {
    it('should produce consistent hashes', () => {
      const key = 'test-key';
      const data = 'test-data';

      const hash1 = createHmac('sha256', key).update(data).digest('hex');
      const hash2 = createHmac('sha256', key).update(data).digest('hex');

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // 256 bits = 64 hex chars
    });

    it('should produce different hashes for different data', () => {
      const key = 'test-key';

      const hash1 = createHmac('sha256', key).update('data1').digest('hex');
      const hash2 = createHmac('sha256', key).update('data2').digest('hex');

      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hashes for different keys', () => {
      const data = 'test-data';

      const hash1 = createHmac('sha256', 'key1').update(data).digest('hex');
      const hash2 = createHmac('sha256', 'key2').update(data).digest('hex');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Random Bytes Generation', () => {
    it('should generate bytes of correct length', () => {
      const lengths = [16, 32, 64];

      for (const length of lengths) {
        const bytes = randomBytes(length);
        expect(bytes).toHaveLength(length);
      }
    });

    it('should generate unique values', () => {
      const values = new Set<string>();

      for (let i = 0; i < 100; i++) {
        values.add(randomBytes(32).toString('hex'));
      }

      expect(values.size).toBe(100);
    });
  });

  describe('Hex Encoding', () => {
    it('should convert bytes to hex correctly', () => {
      const bytes = Buffer.from([0x00, 0x01, 0xff, 0xab]);
      const hex = bytes.toString('hex');

      expect(hex).toBe('0001ffab');
    });

    it('should convert hex to bytes correctly', () => {
      const hex = '0001ffab';
      const bytes = Buffer.from(hex, 'hex');

      expect(Array.from(bytes)).toEqual([0x00, 0x01, 0xff, 0xab]);
    });

    it('should be reversible', () => {
      const original = randomBytes(32);
      const hex = original.toString('hex');
      const restored = Buffer.from(hex, 'hex');

      expect(Buffer.compare(original, restored)).toBe(0);
    });
  });

  describe('Base64 Encoding', () => {
    it('should encode correctly', () => {
      const data = 'Hello, World!';
      const encoded = Buffer.from(data).toString('base64');

      expect(encoded).toBe('SGVsbG8sIFdvcmxkIQ==');
    });

    it('should decode correctly', () => {
      const encoded = 'SGVsbG8sIFdvcmxkIQ==';
      const decoded = Buffer.from(encoded, 'base64').toString();

      expect(decoded).toBe('Hello, World!');
    });

    it('should handle binary data', () => {
      const bytes = randomBytes(64);
      const encoded = bytes.toString('base64');
      const decoded = Buffer.from(encoded, 'base64');

      expect(Buffer.compare(bytes, decoded)).toBe(0);
    });
  });
});

describe('Telegram Auth Hash Validation', () => {
  const BOT_TOKEN = '1234567890:ABCdefGHIjklMNOpqrsTUVwxyz';

  function validateTelegramHash(
    initData: string,
    botToken: string
  ): { valid: boolean; data?: Record<string, string> } {
    try {
      const params = new URLSearchParams(initData);
      const hash = params.get('hash');

      if (!hash) {
        return { valid: false };
      }

      // Build data-check-string
      const entries: string[] = [];
      params.forEach((value, key) => {
        if (key !== 'hash') {
          entries.push(`${key}=${value}`);
        }
      });
      entries.sort();
      const dataCheckString = entries.join('\n');

      // Calculate expected hash
      const secretKey = createHmac('sha256', 'WebAppData')
        .update(botToken)
        .digest();

      const expectedHash = createHmac('sha256', secretKey)
        .update(dataCheckString)
        .digest('hex');

      return {
        valid: hash === expectedHash,
        data: Object.fromEntries(params),
      };
    } catch {
      return { valid: false };
    }
  }

  function createValidInitData(
    data: Record<string, string>,
    botToken: string
  ): string {
    const entries = Object.entries(data)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`);

    const dataCheckString = entries.join('\n');

    const secretKey = createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const hash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    return new URLSearchParams({ ...data, hash }).toString();
  }

  it('should validate correct hash', () => {
    const data = {
      auth_date: Math.floor(Date.now() / 1000).toString(),
      user: JSON.stringify({ id: 123, first_name: 'Test' }),
    };

    const initData = createValidInitData(data, BOT_TOKEN);
    const result = validateTelegramHash(initData, BOT_TOKEN);

    expect(result.valid).toBe(true);
  });

  it('should reject tampered data', () => {
    const data = {
      auth_date: Math.floor(Date.now() / 1000).toString(),
      user: JSON.stringify({ id: 123, first_name: 'Test' }),
    };

    const initData = createValidInitData(data, BOT_TOKEN);

    // Tamper with the data
    const tampered = initData.replace('Test', 'Hacker');
    const result = validateTelegramHash(tampered, BOT_TOKEN);

    expect(result.valid).toBe(false);
  });

  it('should reject wrong bot token', () => {
    const data = {
      auth_date: Math.floor(Date.now() / 1000).toString(),
      user: JSON.stringify({ id: 123, first_name: 'Test' }),
    };

    const initData = createValidInitData(data, BOT_TOKEN);
    const result = validateTelegramHash(initData, 'wrong_token');

    expect(result.valid).toBe(false);
  });

  it('should reject missing hash', () => {
    const params = new URLSearchParams({
      auth_date: '1234567890',
      user: '{}',
    });

    const result = validateTelegramHash(params.toString(), BOT_TOKEN);

    expect(result.valid).toBe(false);
  });
});

describe('Rate Limiting Logic', () => {
  class RateLimiter {
    private attempts: Map<string, { count: number; resetAt: number }> = new Map();

    constructor(
      private maxAttempts: number,
      private windowMs: number
    ) {}

    isAllowed(key: string): boolean {
      const now = Date.now();
      const record = this.attempts.get(key);

      if (!record || now > record.resetAt) {
        this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
        return true;
      }

      if (record.count >= this.maxAttempts) {
        return false;
      }

      record.count++;
      return true;
    }

    getRemainingAttempts(key: string): number {
      const record = this.attempts.get(key);
      if (!record || Date.now() > record.resetAt) {
        return this.maxAttempts;
      }
      return Math.max(0, this.maxAttempts - record.count);
    }
  }

  it('should allow requests within limit', () => {
    const limiter = new RateLimiter(5, 60000);
    const key = 'user:123';

    for (let i = 0; i < 5; i++) {
      expect(limiter.isAllowed(key)).toBe(true);
    }
  });

  it('should block requests over limit', () => {
    const limiter = new RateLimiter(3, 60000);
    const key = 'user:123';

    expect(limiter.isAllowed(key)).toBe(true);
    expect(limiter.isAllowed(key)).toBe(true);
    expect(limiter.isAllowed(key)).toBe(true);
    expect(limiter.isAllowed(key)).toBe(false);
    expect(limiter.isAllowed(key)).toBe(false);
  });

  it('should track remaining attempts', () => {
    const limiter = new RateLimiter(5, 60000);
    const key = 'user:123';

    expect(limiter.getRemainingAttempts(key)).toBe(5);
    limiter.isAllowed(key);
    expect(limiter.getRemainingAttempts(key)).toBe(4);
    limiter.isAllowed(key);
    limiter.isAllowed(key);
    expect(limiter.getRemainingAttempts(key)).toBe(2);
  });

  it('should isolate different keys', () => {
    const limiter = new RateLimiter(2, 60000);

    expect(limiter.isAllowed('user:1')).toBe(true);
    expect(limiter.isAllowed('user:1')).toBe(true);
    expect(limiter.isAllowed('user:1')).toBe(false);

    // Different user should still have attempts
    expect(limiter.isAllowed('user:2')).toBe(true);
    expect(limiter.isAllowed('user:2')).toBe(true);
  });
});
