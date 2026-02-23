import type { Context, NextFunction } from 'grammy';
import { eq } from 'drizzle-orm';
import { db, users } from '../../db/index.js';

export async function authMiddleware(ctx: Context, next: NextFunction) {
  const telegramId = ctx.from?.id.toString();

  if (!telegramId) {
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);

  if (user) {
    await db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, user.id));
  }

  await next();
}
