import type { Context } from 'grammy';
import { eq } from 'drizzle-orm';
import { db, users } from '../../db/index.js';
import { WalletService } from '../../services/wallet/index.js';
import { getCantonSDK } from '../../services/canton/index.js';
import { openWalletKeyboard } from '../keyboards/index.js';
import { logger } from '../../lib/logger.js';

export async function startCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  const telegramUsername = ctx.from?.username;

  if (!telegramId) {
    await ctx.reply('Could not identify user.');
    return;
  }

  let [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);

  const isNewUser = !user;

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

  if (isNewUser) {
    await ctx.reply(
      `Welcome to CC Bot Wallet\n\nTap the button below to get started.`,
      {
        reply_markup: openWalletKeyboard(),
      }
    );
  } else {
    await ctx.reply(`Welcome back!\n\nTap the button below to open your wallet.`, {
      reply_markup: openWalletKeyboard(),
    });
  }
}
