/**
 * AI Agent Rate Limiting
 *
 * Limits:
 * - On-chain transactions: 5/day per user
 * - Chat messages: 50/hour, 200/day per user
 */

import { Redis } from 'ioredis';
import { env } from '../../config/env.js';

const redis = new Redis(env.REDIS_URL);

// Rate limit configurations
const LIMITS = {
  // On-chain transactions (send, swap, register)
  transaction: {
    daily: 5,
    windowSeconds: 86400, // 24 hours
  },
  // Chat messages
  chat: {
    hourly: 50,
    daily: 200,
    hourWindowSeconds: 3600,
    dayWindowSeconds: 86400,
  },
};

type LimitType = 'transaction' | 'chat';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // seconds until reset
  limit: number;
}

/**
 * Check and consume rate limit for a user
 */
export async function checkRateLimit(
  telegramId: string,
  type: LimitType
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);

  if (type === 'transaction') {
    return checkTransactionLimit(telegramId, now);
  } else {
    return checkChatLimit(telegramId, now);
  }
}

/**
 * Check transaction rate limit (5/day)
 */
async function checkTransactionLimit(
  telegramId: string,
  _now: number
): Promise<RateLimitResult> {
  const key = `ratelimit:tx:${telegramId}`;
  const { daily, windowSeconds } = LIMITS.transaction;

  // Get current count
  const count = await redis.get(key);
  const currentCount = count ? parseInt(count, 10) : 0;

  if (currentCount >= daily) {
    const ttl = await redis.ttl(key);
    return {
      allowed: false,
      remaining: 0,
      resetIn: ttl > 0 ? ttl : windowSeconds,
      limit: daily,
    };
  }

  // Increment counter
  const newCount = await redis.incr(key);

  // Set expiry if this is the first request
  if (newCount === 1) {
    await redis.expire(key, windowSeconds);
  }

  const ttl = await redis.ttl(key);

  return {
    allowed: true,
    remaining: daily - newCount,
    resetIn: ttl > 0 ? ttl : windowSeconds,
    limit: daily,
  };
}

/**
 * Check chat rate limit (50/hour, 200/day)
 */
async function checkChatLimit(
  telegramId: string,
  _now: number
): Promise<RateLimitResult> {
  const hourKey = `ratelimit:chat:hour:${telegramId}`;
  const dayKey = `ratelimit:chat:day:${telegramId}`;
  const { hourly, daily, hourWindowSeconds, dayWindowSeconds } = LIMITS.chat;

  // Check hourly limit
  const hourCount = await redis.get(hourKey);
  const currentHourCount = hourCount ? parseInt(hourCount, 10) : 0;

  if (currentHourCount >= hourly) {
    const ttl = await redis.ttl(hourKey);
    return {
      allowed: false,
      remaining: 0,
      resetIn: ttl > 0 ? ttl : hourWindowSeconds,
      limit: hourly,
    };
  }

  // Check daily limit
  const dayCount = await redis.get(dayKey);
  const currentDayCount = dayCount ? parseInt(dayCount, 10) : 0;

  if (currentDayCount >= daily) {
    const ttl = await redis.ttl(dayKey);
    return {
      allowed: false,
      remaining: 0,
      resetIn: ttl > 0 ? ttl : dayWindowSeconds,
      limit: daily,
    };
  }

  // Increment both counters
  const newHourCount = await redis.incr(hourKey);
  const newDayCount = await redis.incr(dayKey);

  // Set expiry if first request
  if (newHourCount === 1) {
    await redis.expire(hourKey, hourWindowSeconds);
  }
  if (newDayCount === 1) {
    await redis.expire(dayKey, dayWindowSeconds);
  }

  const remaining = Math.min(hourly - newHourCount, daily - newDayCount);
  const hourTtl = await redis.ttl(hourKey);

  return {
    allowed: true,
    remaining,
    resetIn: hourTtl > 0 ? hourTtl : hourWindowSeconds,
    limit: hourly,
  };
}

/**
 * Get current usage stats for a user
 */
export async function getUsageStats(telegramId: string): Promise<{
  transactions: { used: number; limit: number; resetIn: number };
  chat: { used: number; hourlyLimit: number; dailyLimit: number };
}> {
  const txKey = `ratelimit:tx:${telegramId}`;
  const chatHourKey = `ratelimit:chat:hour:${telegramId}`;
  const chatDayKey = `ratelimit:chat:day:${telegramId}`;

  const [txCount, txTtl, , chatDayCount] = await Promise.all([
    redis.get(txKey),
    redis.ttl(txKey),
    redis.get(chatHourKey),
    redis.get(chatDayKey),
  ]);

  return {
    transactions: {
      used: txCount ? parseInt(txCount, 10) : 0,
      limit: LIMITS.transaction.daily,
      resetIn: txTtl > 0 ? txTtl : 0,
    },
    chat: {
      used: chatDayCount ? parseInt(chatDayCount, 10) : 0,
      hourlyLimit: LIMITS.chat.hourly,
      dailyLimit: LIMITS.chat.daily,
    },
  };
}
