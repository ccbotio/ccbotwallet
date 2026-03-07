import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock environment FIRST before other imports
vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    APP_SECRET: '0'.repeat(128),
    ENCRYPTION_KEY: '1'.repeat(64),
    RESEND_API_KEY: 'test-resend-key',
    RESEND_FROM_EMAIL: 'test@example.com',
  },
}));

// Mock dependencies before importing the service
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null }),
    },
  })),
}));

vi.mock('../../../db/index.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
  emailCodes: {},
  users: {},
}));

vi.mock('../../../lib/redis.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
  },
  getRedisClient: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  })),
}));

// Mock rate limit middleware - default allows all
const mockRateLimitState = { blocked: false };
vi.mock('../../../api/middleware/rate-limit.js', () => ({
  checkEmailSendLimit: vi.fn().mockImplementation(() =>
    Promise.resolve(mockRateLimitState.blocked
      ? { allowed: false, remaining: 0, resetIn: 60 }
      : { allowed: true, remaining: 3, resetIn: 0 })
  ),
  checkEmailDailyLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 5 }),
  checkEmailIpLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 10 }),
  checkEmailResendCooldown: vi.fn().mockResolvedValue({ allowed: true, waitSeconds: 0 }),
}));

vi.mock('../../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock auth service to prevent transitive env import issues
vi.mock('../../../services/auth/index.js', () => ({
  createTokens: vi.fn().mockResolvedValue({ accessToken: 'test', refreshToken: 'test' }),
  verifyAccessToken: vi.fn().mockResolvedValue({ telegramId: 'test', sub: 'test' }),
}));

// Mock jwt-auth middleware
vi.mock('../../../api/middleware/jwt-auth.js', () => ({
  jwtAuth: vi.fn().mockImplementation((_req, _reply, done) => done()),
}));

describe('EmailService', () => {
  let EmailService: typeof import('../index.js').EmailService;
  let emailService: InstanceType<typeof EmailService>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamic import to get fresh instance with mocks
    const module = await import('../index.js');
    EmailService = module.EmailService;
    emailService = new EmailService();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('sendCode', () => {
    it('should reject invalid email format', async () => {
      const result = await emailService.sendCode('user-123', 'invalid-email');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid email format');
    });

    it('should generate 6-digit code', async () => {
      const result = await emailService.sendCode('user-123', 'test@example.com');

      expect(result.success).toBe(true);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should respect rate limiting', async () => {
      const { checkEmailSendLimit } = await import('../../../api/middleware/rate-limit.js');
      vi.mocked(checkEmailSendLimit).mockResolvedValueOnce({
        allowed: false,
        remaining: 0,
        resetIn: 60,
      });

      const result = await emailService.sendCode('user-123', 'test@example.com');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Too many requests');
    });
  });

  describe('verifyCode', () => {
    it('should return error for expired/not found code', async () => {
      const result = await emailService.verifyCode('user-123', 'test@example.com', '123456');

      expect(result.success).toBe(false);
      expect(result.message).toContain('expired or not found');
    });

    it('should verify valid code', async () => {
      const { db } = await import('../../../db/index.js');
      const mockCode = {
        id: 'code-123',
        userId: 'user-123',
        email: 'test@example.com',
        code: '123456',
        attempts: 0,
        expiresAt: new Date(Date.now() + 300000),
        verifiedAt: null,
      };

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockCode]),
            }),
          }),
        }),
      } as never);

      const result = await emailService.verifyCode('user-123', 'test@example.com', '123456');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Email verified successfully');
    });

    it('should reject wrong code', async () => {
      const { db } = await import('../../../db/index.js');
      const mockCode = {
        id: 'code-123',
        userId: 'user-123',
        email: 'test@example.com',
        code: '123456',
        attempts: 0,
        expiresAt: new Date(Date.now() + 300000),
        verifiedAt: null,
      };

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockCode]),
            }),
          }),
        }),
      } as never);

      const result = await emailService.verifyCode('user-123', 'test@example.com', '000000');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid code');
    });

    it('should reject already used code', async () => {
      const { db } = await import('../../../db/index.js');
      const mockCode = {
        id: 'code-123',
        userId: 'user-123',
        email: 'test@example.com',
        code: '123456',
        attempts: 0,
        expiresAt: new Date(Date.now() + 300000),
        verifiedAt: new Date(), // Already verified
      };

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockCode]),
            }),
          }),
        }),
      } as never);

      const result = await emailService.verifyCode('user-123', 'test@example.com', '123456');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Code already used');
    });

    it('should reject after max attempts', async () => {
      const { db } = await import('../../../db/index.js');
      const mockCode = {
        id: 'code-123',
        userId: 'user-123',
        email: 'test@example.com',
        code: '123456',
        attempts: 5, // Max attempts reached
        expiresAt: new Date(Date.now() + 300000),
        verifiedAt: null,
      };

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([mockCode]),
            }),
          }),
        }),
      } as never);

      const result = await emailService.verifyCode('user-123', 'test@example.com', '123456');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Too many attempts');
    });
  });

  describe('isEmailVerified', () => {
    it('should return false for unverified user', async () => {
      const { db } = await import('../../../db/index.js');

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ isVerified: false }]),
          }),
        }),
      } as never);

      const result = await emailService.isEmailVerified('user-123');

      expect(result).toBe(false);
    });

    it('should return true for verified user', async () => {
      const { db } = await import('../../../db/index.js');

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ isVerified: true }]),
          }),
        }),
      } as never);

      const result = await emailService.isEmailVerified('user-123');

      expect(result).toBe(true);
    });

    it('should return false for non-existent user', async () => {
      const { db } = await import('../../../db/index.js');

      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      } as never);

      const result = await emailService.isEmailVerified('user-123');

      expect(result).toBe(false);
    });
  });
});
