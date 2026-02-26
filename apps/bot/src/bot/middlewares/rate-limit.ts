import type { Context, NextFunction } from 'grammy';
import { redis } from '../../lib/redis.js';
import { RATE_LIMITS } from '../../config/constants.js';

// DEV MODE: Disable rate limits
const DEV_MODE = true;

export async function rateLimitMiddleware(ctx: Context, next: NextFunction) {
  if (DEV_MODE) {
    await next();
    return;
  }

  const userId = ctx.from?.id;

  if (!userId) {
    await next();
    return;
  }

  const key = `rate:cmd:${userId}`;
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, RATE_LIMITS.commands.window);
  }

  if (current > RATE_LIMITS.commands.max) {
    await ctx.reply('Too many requests. Please slow down.');
    return;
  }

  await next();
}
