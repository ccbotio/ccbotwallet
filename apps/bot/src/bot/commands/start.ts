import type { Context } from 'grammy';
import { eq } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import { db, users } from '../../db/index.js';
import { logger } from '../../lib/logger.js';

export async function startCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  const telegramUsername = ctx.from?.username;

  if (!telegramId) {
    await ctx.reply('Could not identify user.');
    return;
  }

  let [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);

  if (!user) {
    // Only create user record - wallet will be created during Mini App onboarding
    // after email verification and passkey setup
    [user] = await db
      .insert(users)
      .values({
        telegramId,
        telegramUsername,
      })
      .returning();

    logger.info({ userId: user?.id, telegramId }, 'User created (wallet will be created during onboarding)');
  }

  // Welcome message with social links
  const welcomeMessage = `*CC Bot Wallet*

Your gateway to the Canton Network.

_Stay tuned for updates!_

Follow us:`;

  // Keyboard with Open Wallet button and social links
  const keyboard = new InlineKeyboard()
    .webApp('Open Wallet', process.env.TELEGRAM_MINI_APP_URL || 'https://app.ccbot.io')
    .row()
    .url('Telegram', 'https://t.me/ccbotwallet')
    .url('X (Twitter)', 'https://x.com/ccbotio');

  await ctx.reply(welcomeMessage, {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}
