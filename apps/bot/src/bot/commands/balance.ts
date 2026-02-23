import type { Context } from 'grammy';
import { eq } from 'drizzle-orm';
import { db, users, wallets } from '../../db/index.js';
import { WalletService } from '../../services/wallet/index.js';
import { getCantonSDK } from '../../services/canton/index.js';
import { formatAmount } from '@repo/shared/utils';

export async function balanceCommand(ctx: Context) {
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

  const walletService = new WalletService(getCantonSDK());
  const balance = await walletService.getBalance(wallet.partyId);

  await ctx.reply(`*Balance:* ${formatAmount(balance.amount)} CC`, { parse_mode: 'Markdown' });
}
