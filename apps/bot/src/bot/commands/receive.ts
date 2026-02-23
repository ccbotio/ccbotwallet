import type { Context } from 'grammy';
import { eq } from 'drizzle-orm';
import { db, users, wallets } from '../../db/index.js';

export async function receiveCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();

  if (!telegramId) {
    await ctx.reply('Could not identify user.');
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);

  if (!user) {
    await ctx.reply('Please use /start first to create your wallet.');
    return;
  }

  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);

  if (!wallet) {
    await ctx.reply('Wallet not found. Please use /start to create one.');
    return;
  }

  await ctx.reply(
    `*Receive CC*\n\n` +
      `Your wallet address:\n` +
      `\`${wallet.partyId}\`\n\n` +
      `Share this address with the sender. ` +
      `Open the Mini App for a QR code.`,
    { parse_mode: 'Markdown' }
  );
}
