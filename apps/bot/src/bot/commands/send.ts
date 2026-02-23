import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { eq } from 'drizzle-orm';
import { db, users, wallets } from '../../db/index.js';
import { env } from '../../config/env.js';

export async function sendCommand(ctx: Context) {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) {
    await ctx.reply('Could not identify user.');
    return;
  }

  // Check if user has wallet
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

  const args = ctx.message?.text?.split(' ').slice(1) ?? [];

  // No args: show help and quick actions
  if (args.length === 0) {
    const keyboard = new InlineKeyboard()
      .webApp('Send via App', `${env.TELEGRAM_MINI_APP_URL}?action=send`)
      .row()
      .text('My Party ID', 'action:myparty');

    await ctx.reply(
      `*Send CC*\n\n` +
        `*Quick Command:*\n` +
        `\`/send <amount> <partyId>\`\n\n` +
        `*Example:*\n` +
        `\`/send 100 ccbot-user::1220abc...\`\n\n` +
        `*Or use the Mini App for a better experience:*`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
    return;
  }

  // Only amount provided: ask for recipient
  if (args.length === 1) {
    const amount = args[0];
    const numAmount = parseFloat(amount ?? '0');

    if (isNaN(numAmount) || numAmount <= 0) {
      await ctx.reply(
        '*Invalid amount*\n\nPlease provide a positive number.\n\nExample: `/send 100`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await ctx.reply(
      `*Send ${amount} CC*\n\n` +
        `Now provide the recipient's Party ID:\n\n` +
        `\`/send ${amount} <partyId>\``,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Full command: amount + partyId
  const [amount, ...partyIdParts] = args;
  const partyId = partyIdParts.join(' '); // In case partyId has spaces (shouldn't but handle it)
  const numAmount = parseFloat(amount ?? '0');

  // Validate amount
  if (isNaN(numAmount) || numAmount <= 0) {
    await ctx.reply('*Invalid amount*\n\nPlease provide a positive number.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  if (numAmount > 1000000) {
    await ctx.reply('*Amount too large*\n\nMaximum single transfer is 1,000,000 CC.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  // Validate partyId format
  if (!partyId || partyId.length < 10) {
    await ctx.reply(
      '*Invalid Party ID*\n\n' +
        'Party IDs look like:\n' +
        '`ccbot-user::1220abc123...`\n\n' +
        'Ask the recipient to share their Party ID from the wallet app.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Check if it looks like a Canton party ID
  const isValidFormat = partyId.includes('::') || partyId.startsWith('ccbot-');
  if (!isValidFormat) {
    await ctx.reply(
      '*Unusual Party ID format*\n\n' +
        "This doesn't look like a standard Canton Party ID.\n" +
        "Please verify the recipient's address.",
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Check if sending to self
  if (partyId === wallet.partyId) {
    await ctx.reply('*Cannot send to yourself*\n\nPlease provide a different recipient.', {
      parse_mode: 'Markdown',
    });
    return;
  }

  // Show confirmation and redirect to Mini App
  const shortPartyId =
    partyId.length > 30 ? `${partyId.slice(0, 15)}...${partyId.slice(-10)}` : partyId;

  const keyboard = new InlineKeyboard().webApp(
    'Confirm in App',
    `${env.TELEGRAM_MINI_APP_URL}?action=send&amount=${amount}&to=${encodeURIComponent(partyId)}`
  );

  await ctx.reply(
    `*Transfer Summary*\n\n` +
      `*Amount:* ${numAmount.toLocaleString()} CC\n` +
      `*To:* \`${shortPartyId}\`\n\n` +
      `_PIN confirmation required for security._\n` +
      `_Please complete this transfer in the Mini App._`,
    {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    }
  );
}

export async function handleSendCallback(ctx: Context, action: string) {
  const parts = action.split(':');

  if (parts[1] === 'amount') {
    const amount = parts[2];
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `*Send ${amount} CC*\n\n` +
        `Now provide the recipient's Party ID:\n\n` +
        `\`/send ${amount} <partyId>\``,
      { parse_mode: 'Markdown' }
    );
  }
}
