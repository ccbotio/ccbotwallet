import type { FastifyRequest, FastifyReply } from 'fastify';
import { redis } from '../../lib/redis.js';
import { RATE_LIMITS, SUSPICIOUS_ACTIVITY } from '../../config/constants.js';
import { getAuthTelegramId } from './jwt-auth.js';
import { logger } from '../../lib/logger.js';

// ============================================================
// DEV MODE: All rate limits disabled for testing
// Set to false in production
// ============================================================
const DEV_MODE = false;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get client IP address from request
 * Handles proxy headers (X-Forwarded-For, X-Real-IP)
 */
function getClientIp(request: FastifyRequest): string {
  const forwardedFor = request.headers['x-forwarded-for'];
  const realIp = request.headers['x-real-ip'];

  if (typeof forwardedFor === 'string') {
    const firstIp = forwardedFor.split(',')[0];
    return firstIp ? firstIp.trim() : 'unknown';
  }
  if (typeof realIp === 'string') {
    return realIp;
  }
  return request.ip || 'unknown';
}

/**
 * Get rate limit identifier for authenticated/unauthenticated requests
 */
function getRateLimitIdentifier(request: FastifyRequest): string {
  const telegramId = getAuthTelegramId(request);
  if (telegramId) {
    return `user:${telegramId}`;
  }
  return `ip:${getClientIp(request)}`;
}

/**
 * Generic rate limit check using Redis sliding window
 */
async function checkRateLimit(
  key: string,
  max: number,
  windowSeconds: number
): Promise<{ allowed: boolean; current: number; remaining: number; resetIn: number }> {
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, windowSeconds);
  }

  const ttl = await redis.ttl(key);
  const remaining = Math.max(0, max - current);
  const allowed = current <= max;

  return { allowed, current, remaining, resetIn: ttl > 0 ? ttl : windowSeconds };
}

/**
 * Send 429 Too Many Requests response
 */
function sendRateLimitResponse(
  reply: FastifyReply,
  message: string,
  resetIn?: number
): FastifyReply {
  const headers: Record<string, string> = {};
  if (resetIn) {
    headers['Retry-After'] = String(resetIn);
  }

  return reply
    .status(429)
    .headers(headers)
    .send({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message,
        retryAfter: resetIn,
      },
    });
}

// ============================================================
// API RATE LIMITERS
// ============================================================

/**
 * General API rate limit for authenticated users
 * Limit: 60 requests/minute
 */
export async function apiRateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (DEV_MODE) return;

  const identifier = getRateLimitIdentifier(request);
  const isAuthenticated = identifier.startsWith('user:');
  const limit = isAuthenticated ? RATE_LIMITS.api : RATE_LIMITS.apiUnauthenticated;

  const key = `rate:api:${identifier}`;
  const result = await checkRateLimit(key, limit.max, limit.window);

  if (!result.allowed) {
    logger.warn({ identifier, current: result.current }, 'API rate limit exceeded');
    sendRateLimitResponse(reply, 'Too many requests. Please try again later.', result.resetIn);
    return;
  }
}

/**
 * Burst protection - prevents rapid-fire requests
 * Limit: 10 requests/second
 */
export async function burstRateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (DEV_MODE) return;

  const identifier = getRateLimitIdentifier(request);
  const key = `rate:burst:${identifier}`;
  const result = await checkRateLimit(key, RATE_LIMITS.apiBurst.max, RATE_LIMITS.apiBurst.window);

  if (!result.allowed) {
    logger.warn({ identifier }, 'Burst rate limit exceeded');
    sendRateLimitResponse(reply, 'Too many requests. Please slow down.', 1);
    return;
  }
}

// ============================================================
// AUTHENTICATION RATE LIMITERS
// ============================================================

/**
 * Authentication endpoint rate limit (stricter)
 * Limit: 10 requests/minute per IP
 */
export async function authRateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (DEV_MODE) return;

  const ip = getClientIp(request);
  const key = `rate:auth:${ip}`;
  const result = await checkRateLimit(key, RATE_LIMITS.auth.max, RATE_LIMITS.auth.window);

  if (!result.allowed) {
    logger.warn({ ip, current: result.current }, 'Auth rate limit exceeded');
    sendRateLimitResponse(
      reply,
      'Too many authentication attempts. Please try again later.',
      result.resetIn
    );
    return;
  }
}

/**
 * Track failed login attempts for suspicious activity detection
 */
export async function trackFailedLogin(ip: string, telegramId?: string): Promise<{
  shouldAlert: boolean;
  failedCount: number;
}> {
  if (DEV_MODE) return { shouldAlert: false, failedCount: 0 };

  const key = `rate:auth:failed:${ip}`;
  const result = await checkRateLimit(key, RATE_LIMITS.authFailed.max, RATE_LIMITS.authFailed.window);

  const shouldAlert = result.current >= SUSPICIOUS_ACTIVITY.loginFailuresAlert;

  if (shouldAlert) {
    logger.warn({ ip, telegramId, failedCount: result.current }, 'Suspicious login activity detected');
  }

  return { shouldAlert, failedCount: result.current };
}

/**
 * Reset failed login counter on successful login
 */
export async function resetFailedLogins(ip: string): Promise<void> {
  await redis.del(`rate:auth:failed:${ip}`);
}

// ============================================================
// PIN RATE LIMITERS
// ============================================================

/**
 * PIN attempt rate limiting with progressive lockout
 */
export async function checkPinRateLimit(telegramId: string): Promise<{
  allowed: boolean;
  remainingAttempts: number;
  lockedUntil?: number;
  lockLevel?: number;
}> {
  if (DEV_MODE) {
    return { allowed: true, remainingAttempts: 999 };
  }

  const lockKey = `lock:pin:${telegramId}`;
  const attemptsKey = `rate:pin:${telegramId}`;
  const lockLevelKey = `lock:pin:level:${telegramId}`;

  // Check if currently locked
  const lockTTL = await redis.ttl(lockKey);
  if (lockTTL > 0) {
    const lockLevel = parseInt(await redis.get(lockLevelKey) || '0', 10);
    return {
      allowed: false,
      remainingAttempts: 0,
      lockedUntil: Date.now() + lockTTL * 1000,
      lockLevel,
    };
  }

  // Check attempts
  const attempts = await redis.incr(attemptsKey);
  if (attempts === 1) {
    await redis.expire(attemptsKey, RATE_LIMITS.pinAttempts.window);
  }

  if (attempts > RATE_LIMITS.pinAttempts.max) {
    // Get current lock level and increment
    let lockLevel = parseInt(await redis.get(lockLevelKey) || '0', 10);
    lockLevel = Math.min(lockLevel + 1, RATE_LIMITS.pinLockoutDurations.length);

    const lockDuration = RATE_LIMITS.pinLockoutDurations[lockLevel - 1] || RATE_LIMITS.pinLockoutDurations[0];

    // Set lock
    await redis.setex(lockKey, lockDuration, '1');
    await redis.setex(lockLevelKey, 86400 * 7, String(lockLevel)); // Remember level for 7 days
    await redis.del(attemptsKey);

    logger.warn({ telegramId, lockLevel, lockDuration }, 'PIN locked due to too many attempts');

    return {
      allowed: false,
      remainingAttempts: 0,
      lockedUntil: Date.now() + lockDuration * 1000,
      lockLevel,
    };
  }

  return {
    allowed: true,
    remainingAttempts: RATE_LIMITS.pinAttempts.max - attempts,
  };
}

/**
 * Reset PIN attempts on successful entry
 */
export async function resetPinAttempts(telegramId: string): Promise<void> {
  await redis.del(`rate:pin:${telegramId}`);
  // Also reset lock level on successful PIN entry
  await redis.del(`lock:pin:level:${telegramId}`);
}

/**
 * PIN change rate limit
 * Limit: 3 changes/day
 */
export async function checkPinChangeLimit(telegramId: string): Promise<{
  allowed: boolean;
  remaining: number;
}> {
  if (DEV_MODE) return { allowed: true, remaining: 999 };

  const key = `rate:pin:change:${telegramId}`;
  const result = await checkRateLimit(key, RATE_LIMITS.pinChange.max, RATE_LIMITS.pinChange.window);

  if (!result.allowed) {
    logger.warn({ telegramId }, 'PIN change rate limit exceeded');
  }

  return { allowed: result.allowed, remaining: result.remaining };
}

// ============================================================
// EMAIL RATE LIMITERS
// ============================================================

/**
 * Email send rate limit (per user)
 * Limit: 3 emails/hour
 */
export async function checkEmailSendLimit(userId: string): Promise<{
  allowed: boolean;
  remaining: number;
  resetIn: number;
}> {
  if (DEV_MODE) return { allowed: true, remaining: 999, resetIn: 0 };

  const key = `rate:email:send:${userId}`;
  const result = await checkRateLimit(key, RATE_LIMITS.emailSend.max, RATE_LIMITS.emailSend.window);

  if (!result.allowed) {
    logger.warn({ userId }, 'Email send rate limit exceeded (per user)');
  }

  return { allowed: result.allowed, remaining: result.remaining, resetIn: result.resetIn };
}

/**
 * Email daily limit (per email address)
 * Limit: 5 codes/day per email
 */
export async function checkEmailDailyLimit(email: string): Promise<{
  allowed: boolean;
  remaining: number;
}> {
  if (DEV_MODE) return { allowed: true, remaining: 999 };

  const key = `rate:email:daily:${email.toLowerCase()}`;
  const result = await checkRateLimit(key, RATE_LIMITS.emailDaily.max, RATE_LIMITS.emailDaily.window);

  if (!result.allowed) {
    logger.warn({ email }, 'Email daily rate limit exceeded');
  }

  return { allowed: result.allowed, remaining: result.remaining };
}

/**
 * Email IP rate limit
 * Limit: 10 emails/hour per IP
 */
export async function checkEmailIpLimit(ip: string): Promise<{
  allowed: boolean;
  remaining: number;
}> {
  if (DEV_MODE) return { allowed: true, remaining: 999 };

  const key = `rate:email:ip:${ip}`;
  const result = await checkRateLimit(key, RATE_LIMITS.emailIp.max, RATE_LIMITS.emailIp.window);

  if (!result.allowed) {
    logger.warn({ ip }, 'Email IP rate limit exceeded');
  }

  return { allowed: result.allowed, remaining: result.remaining };
}

/**
 * Email verification attempts limit (per code)
 * Limit: 5 attempts per code
 */
export async function checkEmailVerifyLimit(codeId: string): Promise<{
  allowed: boolean;
  remaining: number;
}> {
  if (DEV_MODE) return { allowed: true, remaining: 999 };

  const key = `rate:email:verify:${codeId}`;
  const result = await checkRateLimit(key, RATE_LIMITS.emailVerify.max, RATE_LIMITS.emailVerify.window);

  if (!result.allowed) {
    logger.warn({ codeId }, 'Email verify rate limit exceeded');
  }

  return { allowed: result.allowed, remaining: result.remaining };
}

/**
 * Email resend cooldown
 * Enforces minimum wait time between resends
 */
export async function checkEmailResendCooldown(userId: string): Promise<{
  allowed: boolean;
  waitSeconds: number;
}> {
  if (DEV_MODE) return { allowed: true, waitSeconds: 0 };

  const key = `cooldown:email:resend:${userId}`;
  const ttl = await redis.ttl(key);

  if (ttl > 0) {
    return { allowed: false, waitSeconds: ttl };
  }

  // Set cooldown
  await redis.setex(key, RATE_LIMITS.emailResendCooldown, '1');
  return { allowed: true, waitSeconds: 0 };
}

/**
 * Email change rate limit
 * Limit: 2 changes/day
 */
export async function checkEmailChangeLimit(userId: string): Promise<{
  allowed: boolean;
  remaining: number;
}> {
  if (DEV_MODE) return { allowed: true, remaining: 999 };

  const key = `rate:email:change:${userId}`;
  const result = await checkRateLimit(key, RATE_LIMITS.emailChange.max, RATE_LIMITS.emailChange.window);

  if (!result.allowed) {
    logger.warn({ userId }, 'Email change rate limit exceeded');
  }

  return { allowed: result.allowed, remaining: result.remaining };
}

// ============================================================
// RECOVERY RATE LIMITERS
// ============================================================

/**
 * Recovery attempt rate limit
 * Limit: 3 attempts/hour
 */
export async function checkRecoveryLimit(ip: string): Promise<{
  allowed: boolean;
  remaining: number;
}> {
  if (DEV_MODE) return { allowed: true, remaining: 999 };

  const key = `rate:recovery:${ip}`;
  const result = await checkRateLimit(key, RATE_LIMITS.recovery.max, RATE_LIMITS.recovery.window);

  if (!result.allowed) {
    logger.warn({ ip }, 'Recovery rate limit exceeded');
  }

  return { allowed: result.allowed, remaining: result.remaining };
}

/**
 * Recovery code generation limit
 * Limit: 2 generations/day
 */
export async function checkRecoveryGenerateLimit(userId: string): Promise<{
  allowed: boolean;
  remaining: number;
}> {
  if (DEV_MODE) return { allowed: true, remaining: 999 };

  const key = `rate:recovery:generate:${userId}`;
  const result = await checkRateLimit(
    key,
    RATE_LIMITS.recoveryGenerate.max,
    RATE_LIMITS.recoveryGenerate.window
  );

  if (!result.allowed) {
    logger.warn({ userId }, 'Recovery generate rate limit exceeded');
  }

  return { allowed: result.allowed, remaining: result.remaining };
}

// ============================================================
// WALLET CREATION RATE LIMITERS
// ============================================================

/**
 * Wallet creation rate limit (per IP)
 * Limit: 5 wallets/day per IP
 */
export async function checkWalletCreateIpLimit(ip: string): Promise<{
  allowed: boolean;
  remaining: number;
}> {
  if (DEV_MODE) return { allowed: true, remaining: 999 };

  const key = `rate:wallet:create:ip:${ip}`;
  const result = await checkRateLimit(
    key,
    RATE_LIMITS.walletCreateIp.max,
    RATE_LIMITS.walletCreateIp.window
  );

  if (!result.allowed) {
    logger.warn({ ip }, 'Wallet creation IP rate limit exceeded');
  }

  return { allowed: result.allowed, remaining: result.remaining };
}

/**
 * Wallet creation rate limit (per device fingerprint)
 * Limit: 3 wallets/day per device
 */
export async function checkWalletCreateDeviceLimit(deviceFingerprint: string): Promise<{
  allowed: boolean;
  remaining: number;
}> {
  if (DEV_MODE) return { allowed: true, remaining: 999 };

  const key = `rate:wallet:create:device:${deviceFingerprint}`;
  const result = await checkRateLimit(
    key,
    RATE_LIMITS.walletCreateDevice.max,
    RATE_LIMITS.walletCreateDevice.window
  );

  if (!result.allowed) {
    logger.warn({ deviceFingerprint }, 'Wallet creation device rate limit exceeded');
  }

  return { allowed: result.allowed, remaining: result.remaining };
}

// ============================================================
// SENSITIVE OPERATIONS RATE LIMITERS
// ============================================================

/**
 * Key export rate limit
 * Limit: 2 exports/hour
 */
export async function checkExportKeyLimit(userId: string): Promise<{
  allowed: boolean;
  remaining: number;
}> {
  if (DEV_MODE) return { allowed: true, remaining: 999 };

  const key = `rate:export:key:${userId}`;
  const result = await checkRateLimit(key, RATE_LIMITS.exportKey.max, RATE_LIMITS.exportKey.window);

  if (!result.allowed) {
    logger.warn({ userId }, 'Key export rate limit exceeded');
  }

  return { allowed: result.allowed, remaining: result.remaining };
}

/**
 * Session management rate limit
 * Limit: 10 actions/hour
 */
export async function checkSessionManageLimit(userId: string): Promise<{
  allowed: boolean;
  remaining: number;
}> {
  if (DEV_MODE) return { allowed: true, remaining: 999 };

  const key = `rate:session:manage:${userId}`;
  const result = await checkRateLimit(
    key,
    RATE_LIMITS.sessionManage.max,
    RATE_LIMITS.sessionManage.window
  );

  if (!result.allowed) {
    logger.warn({ userId }, 'Session manage rate limit exceeded');
  }

  return { allowed: result.allowed, remaining: result.remaining };
}

// ============================================================
// TRANSACTION RATE LIMITERS (Placeholder)
// ============================================================

/**
 * Transaction rate limit middleware
 * Will be expanded with daily/amount limits later
 */
export async function transactionRateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (DEV_MODE) return;

  const identifier = getRateLimitIdentifier(request);
  const key = `rate:tx:${identifier}`;
  const result = await checkRateLimit(
    key,
    RATE_LIMITS.transactions.max,
    RATE_LIMITS.transactions.window
  );

  if (!result.allowed) {
    logger.warn({ identifier }, 'Transaction rate limit exceeded');
    sendRateLimitResponse(
      reply,
      'Transaction rate limit reached. Please wait before sending again.',
      result.resetIn
    );
    return;
  }
}

// ============================================================
// UTILITY EXPORTS
// ============================================================

export { getClientIp, getRateLimitIdentifier, checkRateLimit };
