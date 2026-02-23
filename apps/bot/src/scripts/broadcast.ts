import { Bot, InputFile } from 'grammy';
import { db, users } from '../db/index.js';
import { env } from '../config/env.js';

const LOGO_PATH = '/Users/sehereroglu/Desktop/test/photo_5830206053654662572_x.jpg';

const MESSAGE = `CC Bot Wallet

We're building the future of self-custodial wallets on Canton Network.

Coming Soon

Stay connected:
Telegram: t.me/ccbotwallet
X: x.com/ccbotio`;

async function broadcast() {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // Get all users
  const allUsers = await db.select().from(users);

  console.log(`Found ${allUsers.length} users to broadcast to`);

  let sent = 0;
  let failed = 0;

  for (const user of allUsers) {
    try {
      // Send photo with caption
      await bot.api.sendPhoto(
        user.telegramId,
        new InputFile(LOGO_PATH),
        {
          caption: MESSAGE,
        }
      );
      sent++;
      console.log(`Sent to ${user.telegramId} (${sent}/${allUsers.length})`);

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      failed++;
      console.error(`Failed to send to ${user.telegramId}:`, error);
    }
  }

  console.log(`\nBroadcast complete: ${sent} sent, ${failed} failed`);
  process.exit(0);
}

broadcast().catch(console.error);
