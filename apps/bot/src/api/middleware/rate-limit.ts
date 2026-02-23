import type { FastifyRequest, FastifyReply } from 'fastify';
import { redis } from '../../lib/redis.js';
import { RATE_LIMITS } from '../../config/constants.js';
import { getAuthTelegramId } from './jwt-auth.js';

/**
 * Get the client identifier for rate limiting.
 * Uses telegramId for authenticated users, IP address for unauthenticated users.
 */
function getRateLimitIdentifier(request: FastifyRequest): string {
  const telegramId = getAuthTelegramId(request);
  if (telegramId) {
    return `user:${telegramId}`;
  }

  // For unauthenticated requests, use IP address
  // Check common proxy headers first, then fall back to request IP
  const forwardedFor = request.headers['x-forwarded-for'];
  const realIp = request.headers['x-real-ip'];

  let ip: string;
  if (typeof forwardedFor === 'string') {
    // X-Forwarded-For can contain multiple IPs; use the first (client) one
    const firstIp = forwardedFor.split(',')[0];
    ip = firstIp ? firstIp.trim() : 'unknown';
  } else if (typeof realIp === 'string') {
    ip = realIp;
  } else {
    ip = request.ip || 'unknown';
  }

  return `ip:${ip}`;
}

/**
 * Rate limit middleware for API routes.
 * Uses Redis sliding window counter.
 * Uses user ID for authenticated requests, IP address for unauthenticated requests.
 */
export async function apiRateLimitMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const identifier = getRateLimitIdentifier(request);
  const key = `rate:api:${identifier}`;
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, RATE_LIMITS.commands.window);
  }

  if (current > RATE_LIMITS.commands.max) {
    return reply.status(429).send({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
      },
    });
  }
}

/**
 * Rate limit for transaction endpoints.
 * Uses user ID for authenticated requests, IP address for unauthenticated requests.
 */
export async function transactionRateLimitMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const identifier = getRateLimitIdentifier(request);
  const key = `rate:tx:${identifier}`;
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, RATE_LIMITS.transactions.window);
  }

  if (current > RATE_LIMITS.transactions.max) {
    return reply.status(429).send({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Transaction rate limit reached. Please wait before sending again.',
      },
    });
  }
}

/**
 * Rate limit for authentication endpoints (stricter limits).
 * Always uses IP address since these are unauthenticated endpoints.
 */
export async function authRateLimitMiddleware(request: FastifyRequest, reply: FastifyReply) {
  // For auth endpoints, always use IP since users are not yet authenticated
  const forwardedFor = request.headers['x-forwarded-for'];
  const realIp = request.headers['x-real-ip'];

  let ip: string;
  if (typeof forwardedFor === 'string') {
    const firstIp = forwardedFor.split(',')[0];
    ip = firstIp ? firstIp.trim() : 'unknown';
  } else if (typeof realIp === 'string') {
    ip = realIp;
  } else {
    ip = request.ip || 'unknown';
  }

  const key = `rate:auth:ip:${ip}`;
  const current = await redis.incr(key);

  if (current === 1) {
    // Auth endpoints get a stricter window: 10 requests per 60 seconds
    await redis.expire(key, 60);
  }

  // Stricter limit for auth endpoints: 10 requests per minute per IP
  if (current > 10) {
    return reply.status(429).send({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many authentication attempts. Please try again later.',
      },
    });
  }
}

/**
 * PIN attempt rate limiting.
 * 5 failed attempts → 15 minute lockout.
 */
export async function checkPinRateLimit(telegramId: string): Promise<{
  allowed: boolean;
  remainingAttempts: number;
  lockedUntil?: number;
}> {
  const key = `rate:pin:${telegramId}`;
  const lockKey = `lock:pin:${telegramId}`;

  // Check if locked
  const lockTTL = await redis.ttl(lockKey);
  if (lockTTL > 0) {
    return {
      allowed: false,
      remainingAttempts: 0,
      lockedUntil: Date.now() + lockTTL * 1000,
    };
  }

  const attempts = await redis.incr(key);

  if (attempts === 1) {
    await redis.expire(key, RATE_LIMITS.pinAttempts.window);
  }

  if (attempts > RATE_LIMITS.pinAttempts.max) {
    // Lock the account
    await redis.setex(lockKey, RATE_LIMITS.pinAttempts.window, '1');
    await redis.del(key);

    return {
      allowed: false,
      remainingAttempts: 0,
      lockedUntil: Date.now() + RATE_LIMITS.pinAttempts.window * 1000,
    };
  }

  return {
    allowed: true,
    remainingAttempts: RATE_LIMITS.pinAttempts.max - attempts,
  };
}

/**
 * Reset PIN attempt counter on successful PIN entry.
 */
export async function resetPinAttempts(telegramId: string): Promise<void> {
  await redis.del(`rate:pin:${telegramId}`);
}
