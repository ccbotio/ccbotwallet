import type { Context } from 'grammy';
import { openWalletKeyboard } from '../keyboards/index.js';

export async function helpCommand(ctx: Context) {
  await ctx.reply(
    `*CC Bot Wallet — Help*\n\n` +
      `*Commands:*\n` +
      `/start — Create or access your wallet\n` +
      `/balance — Quick balance check\n` +
      `/wallet — View wallet details\n` +
      `/send <amount> <partyId> — Send CC\n` +
      `/receive — Show your party ID\n` +
      `/history — Recent transactions\n` +
      `/help — Show this help\n\n` +
      `For the full experience, open the Mini App:`,
    {
      parse_mode: 'Markdown',
      reply_markup: openWalletKeyboard(),
    }
  );
}
