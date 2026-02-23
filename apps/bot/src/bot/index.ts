import { Bot } from 'grammy';
import { eq } from 'drizzle-orm';
import { env } from '../config/env.js';
import { startCommand } from './commands/start.js';
import { authMiddleware } from './middlewares/auth.js';
import { loggingMiddleware } from './middlewares/logging.js';
import { rateLimitMiddleware } from './middlewares/rate-limit.js';
import { logger } from '../lib/logger.js';
import { db, users, wallets } from '../db/index.js';

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

bot.use(loggingMiddleware);
bot.use(rateLimitMiddleware);
bot.use(authMiddleware);

// Only keep /start command for deep linking support
bot.command('start', startCommand);

// Callback query handler for party ID display
bot.callbackQuery('action:myparty', async (ctx) => {
  const telegramId = ctx.from?.id.toString();
  if (!telegramId) {
    await ctx.answerCallbackQuery('Could not identify user');
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
  if (!user) {
    await ctx.answerCallbackQuery('Please open the wallet first');
    return;
  }

  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);
  if (!wallet) {
    await ctx.answerCallbackQuery('Wallet not found');
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.reply(
    `*Your Party ID*\n\n` + `\`${wallet.partyId}\`\n\n` + `_Share this with others to receive CC._`,
    { parse_mode: 'Markdown' }
  );
});

// Ignore all messages - users should only use the Launch App button
bot.on('message', async () => {
  // Do nothing - silently ignore all messages
});

bot.catch((err) => {
  logger.error({ err: err.error, ctx: err.ctx }, 'Bot error');
});

export async function initBot() {
  try {
    // Remove all bot commands - users should only use the Launch App button
    await bot.api.deleteMyCommands();
    logger.info('Bot commands removed - Launch App only mode');

    const miniAppUrl = env.TELEGRAM_MINI_APP_URL;
    if (miniAppUrl) {
      await bot.api.setChatMenuButton({
        menu_button: {
          type: 'web_app',
          text: 'Launch App',
          web_app: { url: miniAppUrl },
        },
      });
      logger.info({ url: miniAppUrl }, 'Menu button configured');
    }

    logger.info('Bot initialized successfully');
  } catch (err) {
    logger.warn(
      { err },
      'Failed to initialize Telegram bot (invalid token or API error). API server will continue.'
    );
  }
}
