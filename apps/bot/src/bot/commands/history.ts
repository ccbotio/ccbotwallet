import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { eq, desc, sql } from 'drizzle-orm';
import { db, users, wallets, transactions } from '../../db/index.js';
import { env } from '../../config/env.js';

const PAGE_SIZE = 5;

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatAmount(amount: string): string {
  const num = parseFloat(amount);
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toFixed(2);
}

function shortenPartyId(partyId: string): string {
  if (partyId.length <= 20) return partyId;
  return `${partyId.slice(0, 10)}...${partyId.slice(-6)}`;
}

function getStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case 'confirmed':
    case 'completed':
      return '[OK]';
    case 'pending':
      return '[...]';
    case 'failed':
      return '[X]';
    default:
      return '';
  }
}

export async function historyCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();

  if (!telegramId) {
    await ctx.reply('Could not identify user.');
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);

  if (!user) {
    await ctx.reply('*Wallet not found*\n\nPlease use /start to create your wallet first.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);

  if (!wallet) {
    await ctx.reply('*Wallet not found*\n\nPlease use /start to create your wallet first.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  // Get page from args
  const args = ctx.message?.text?.split(' ').slice(1) ?? [];
  const page = Math.max(1, parseInt(args[0] ?? '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Get total count
  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(eq(transactions.walletId, wallet.id));

  const totalCount = countResult?.count ?? 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  // Get transactions for current page
  const txs = await db
    .select()
    .from(transactions)
    .where(eq(transactions.walletId, wallet.id))
    .orderBy(desc(transactions.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  if (txs.length === 0 && page === 1) {
    const keyboard = new InlineKeyboard().webApp('Open Wallet', env.TELEGRAM_MINI_APP_URL ?? '');

    await ctx.reply(
      '*Transaction History*\n\n' +
        '_No transactions yet._\n\n' +
        'Send or receive CC to see your history here.',
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
    return;
  }

  if (txs.length === 0) {
    await ctx.reply(
      `*Transaction History*\n\n` +
        `_No more transactions._\n\n` +
        `Use /history to see recent transactions.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Build transaction list
  const txLines = txs.map((tx) => {
    const icon = tx.type === 'send' ? 'OUT' : 'IN';
    const sign = tx.type === 'send' ? '-' : '+';
    const amount = formatAmount(tx.amount);
    const status = getStatusLabel(tx.status);
    const counterparty = tx.type === 'send' ? tx.toParty : tx.fromParty;
    const shortParty = shortenPartyId(counterparty ?? 'Unknown');
    const time = formatTimeAgo(new Date(tx.createdAt));

    return (
      `[${icon}] *${sign}${amount} ${tx.token}* ${status}\n` +
      `   ${tx.type === 'send' ? 'To' : 'From'}: \`${shortParty}\`\n` +
      `   ${time}`
    );
  });

  // Build navigation keyboard
  const keyboard = new InlineKeyboard();

  if (page > 1) {
    keyboard.text('< Prev', `history:page:${page - 1}`);
  }

  keyboard.text(`${page}/${totalPages}`, 'history:current');

  if (page < totalPages) {
    keyboard.text('Next >', `history:page:${page + 1}`);
  }

  keyboard.row().webApp('Full History', `${env.TELEGRAM_MINI_APP_URL}?action=history`);

  // Calculate summary stats
  const sentCount = txs.filter((tx) => tx.type === 'send').length;
  const receivedCount = txs.filter((tx) => tx.type === 'receive').length;

  await ctx.reply(
    `*Transaction History*\n` +
      `Page ${page} of ${totalPages} | ${totalCount} total\n\n` +
      txLines.join('\n\n') +
      `\n\n_Showing ${sentCount} sent, ${receivedCount} received_`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

export async function handleHistoryCallback(ctx: Context, action: string) {
  const parts = action.split(':');

  if (parts[1] === 'page') {
    const page = parseInt(parts[2] ?? '1', 10);
    await ctx.answerCallbackQuery();

    // Re-run history with the new page
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (!user) return;

    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);
    if (!wallet) return;

    const offset = (page - 1) * PAGE_SIZE;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(eq(transactions.walletId, wallet.id));

    const totalCount = countResult?.count ?? 0;
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);

    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.walletId, wallet.id))
      .orderBy(desc(transactions.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset);

    const txLines = txs.map((tx) => {
      const icon = tx.type === 'send' ? 'OUT' : 'IN';
      const sign = tx.type === 'send' ? '-' : '+';
      const amount = formatAmount(tx.amount);
      const status = getStatusLabel(tx.status);
      const counterparty = tx.type === 'send' ? tx.toParty : tx.fromParty;
      const shortParty = shortenPartyId(counterparty ?? 'Unknown');
      const time = formatTimeAgo(new Date(tx.createdAt));

      return (
        `[${icon}] *${sign}${amount} ${tx.token}* ${status}\n` +
        `   ${tx.type === 'send' ? 'To' : 'From'}: \`${shortParty}\`\n` +
        `   ${time}`
      );
    });

    const keyboard = new InlineKeyboard();

    if (page > 1) {
      keyboard.text('< Prev', `history:page:${page - 1}`);
    }

    keyboard.text(`${page}/${totalPages}`, 'history:current');

    if (page < totalPages) {
      keyboard.text('Next >', `history:page:${page + 1}`);
    }

    keyboard.row().webApp('Full History', `${env.TELEGRAM_MINI_APP_URL}?action=history`);

    const sentCount = txs.filter((tx) => tx.type === 'send').length;
    const receivedCount = txs.filter((tx) => tx.type === 'receive').length;

    await ctx.editMessageText(
      `*Transaction History*\n` +
        `Page ${page} of ${totalPages} | ${totalCount} total\n\n` +
        txLines.join('\n\n') +
        `\n\n_Showing ${sentCount} sent, ${receivedCount} received_`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
  } else if (parts[1] === 'current') {
    await ctx.answerCallbackQuery('Current page');
  }
}
