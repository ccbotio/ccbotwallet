import type { Context, NextFunction } from 'grammy';
import { logger } from '../../lib/logger.js';

export async function loggingMiddleware(ctx: Context, next: NextFunction) {
  const start = Date.now();

  logger.info(
    {
      userId: ctx.from?.id,
      chatId: ctx.chat?.id,
      text: ctx.message?.text?.slice(0, 50),
    },
    'Incoming update'
  );

  await next();

  const duration = Date.now() - start;
  logger.debug({ duration }, 'Update processed');
}
