import { bot } from '../../bot/index.js';
import { logger } from '../../lib/logger.js';
import { emailService } from '../email/index.js';

export interface NotificationOptions {
  parseMode?: 'Markdown' | 'HTML';
  disableNotification?: boolean;
}

// Notification job types for the queue
export type NotificationType =
  | 'incoming_transfer'
  | 'outgoing_transfer'
  | 'utxo_merge_needed'
  | 'utxo_merge_complete'
  | 'email_verified'
  | 'welcome'
  | 'faucet_received';

export interface NotificationJobData {
  type: NotificationType;
  telegramId: string;
  email?: string;
  data: Record<string, unknown>;
}

/**
 * Send a Telegram notification to a user.
 */
export async function sendTelegramNotification(
  telegramId: string,
  message: string,
  options: NotificationOptions = {}
): Promise<boolean> {
  try {
    const sendOptions: { parse_mode?: 'Markdown' | 'HTML'; disable_notification?: boolean } = {
      parse_mode: options.parseMode ?? 'Markdown',
    };
    if (options.disableNotification !== undefined) {
      sendOptions.disable_notification = options.disableNotification;
    }
    await bot.api.sendMessage(telegramId, message, sendOptions);
    logger.info({ telegramId }, 'Notification sent');
    return true;
  } catch (error) {
    logger.error({ err: error, telegramId }, 'Failed to send notification');
    return false;
  }
}

/**
 * Notify user that their wallet has too many UTXOs and needs merging.
 */
export async function notifyUtxoMergeNeeded(
  telegramId: string,
  utxoCount: number,
  threshold: number
): Promise<boolean> {
  const message =
    `*UTXO Optimization Needed*\n\n` +
    `Your wallet has ${String(utxoCount)} UTXOs (threshold: ${String(threshold)}).\n\n` +
    `Too many UTXOs can slow down transactions. ` +
    `Please open the wallet app and tap "Optimize Wallet" to merge them.\n\n` +
    `_This is an automated maintenance reminder._`;

  return sendTelegramNotification(telegramId, message);
}

/**
 * Notify user of a successful UTXO merge.
 */
export async function notifyUtxoMergeComplete(
  telegramId: string,
  mergedCount: number
): Promise<boolean> {
  const message =
    `*Wallet Optimized*\n\n` +
    `Successfully merged ${String(mergedCount)} UTXOs.\n` +
    `Your wallet is now optimized for faster transactions.`;

  return sendTelegramNotification(telegramId, message);
}

/**
 * Notify user of an incoming transfer.
 */
export async function notifyIncomingTransfer(
  telegramId: string,
  amount: string,
  fromParty: string
): Promise<boolean> {
  const shortFrom =
    fromParty.length > 20 ? `${fromParty.slice(0, 10)}...${fromParty.slice(-8)}` : fromParty;

  const message =
    `*Incoming Transfer*\n\n` + `You received *${amount} CC*\n` + `From: \`${shortFrom}\``;

  return sendTelegramNotification(telegramId, message);
}

/**
 * Notify user of a successful outgoing transfer.
 */
export async function notifyOutgoingTransfer(
  telegramId: string,
  amount: string,
  toParty: string
): Promise<boolean> {
  const shortTo = toParty.length > 20 ? `${toParty.slice(0, 10)}...${toParty.slice(-8)}` : toParty;

  const message = `*Transfer Sent*\n\n` + `You sent *${amount} CC*\n` + `To: \`${shortTo}\``;

  return sendTelegramNotification(telegramId, message);
}

/**
 * Send welcome notification to new user.
 */
export async function notifyWelcome(telegramId: string): Promise<boolean> {
  const message =
    `*Welcome to CC Bot Wallet!* 🎉\n\n` +
    `Your wallet is ready. Here's what you can do:\n\n` +
    `• /balance - Check your balance\n` +
    `• /send - Send CC tokens\n` +
    `• /receive - Get your address\n` +
    `• /history - View transactions\n\n` +
    `Open the Mini App for full features.`;

  return sendTelegramNotification(telegramId, message);
}

/**
 * Notify user that their email was verified.
 */
export async function notifyEmailVerified(telegramId: string, email: string): Promise<boolean> {
  const message =
    `*Email Verified* ✓\n\n` +
    `Your email \`${email}\` has been verified.\n` +
    `You'll receive important notifications there.`;

  return sendTelegramNotification(telegramId, message);
}

/**
 * Send email notification for incoming transfer.
 */
async function sendTransferEmail(
  email: string,
  amount: string,
  direction: 'incoming' | 'outgoing',
  party: string
): Promise<boolean> {
  const subject =
    direction === 'incoming'
      ? `CC Bot - You received ${amount} CC`
      : `CC Bot - You sent ${amount} CC`;

  const shortParty = party.length > 20 ? `${party.slice(0, 10)}...${party.slice(-8)}` : party;

  const directionText = direction === 'incoming' ? 'received from' : 'sent to';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 400px; margin: 0 auto; padding: 20px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <img src="https://ccbot.io/logo.png" alt="CC Bot" width="64" height="64" style="border-radius: 12px;" />
    </div>
    <h2 style="color: #1a1a2e; text-align: center; margin: 0 0 24px 0; font-size: 20px;">
      ${direction === 'incoming' ? 'Transfer Received' : 'Transfer Sent'}
    </h2>
    <div style="background: #f5f5f5; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
      <span style="font-size: 32px; font-weight: bold; color: ${direction === 'incoming' ? '#22c55e' : '#875CFF'};">
        ${direction === 'incoming' ? '+' : '-'}${amount} CC
      </span>
    </div>
    <p style="color: #666; text-align: center; font-size: 14px; margin: 0;">
      ${directionText.charAt(0).toUpperCase() + directionText.slice(1)}: <code style="background: #eee; padding: 2px 6px; border-radius: 4px;">${shortParty}</code>
    </p>
  </div>
</body>
</html>`;

  try {
    return await emailService.sendRawEmail(email, subject, html);
  } catch (error) {
    logger.error({ err: error, email }, 'Failed to send transfer email');
    return false;
  }
}

/**
 * Process a notification job from the queue.
 */
export async function processNotificationJob(jobData: NotificationJobData): Promise<void> {
  const { type, telegramId, email, data } = jobData;

  logger.info({ type, telegramId, email: email ? '***' : undefined }, 'Processing notification');

  switch (type) {
    case 'incoming_transfer': {
      const { amount, fromParty } = data as { amount: string; fromParty: string };
      await notifyIncomingTransfer(telegramId, amount, fromParty);
      if (email) {
        await sendTransferEmail(email, amount, 'incoming', fromParty);
      }
      break;
    }

    case 'outgoing_transfer': {
      const { amount, toParty } = data as { amount: string; toParty: string };
      await notifyOutgoingTransfer(telegramId, amount, toParty);
      if (email) {
        await sendTransferEmail(email, amount, 'outgoing', toParty);
      }
      break;
    }

    case 'utxo_merge_needed': {
      const { utxoCount, threshold } = data as { utxoCount: number; threshold: number };
      await notifyUtxoMergeNeeded(telegramId, utxoCount, threshold);
      break;
    }

    case 'utxo_merge_complete': {
      const { mergedCount } = data as { mergedCount: number };
      await notifyUtxoMergeComplete(telegramId, mergedCount);
      break;
    }

    case 'email_verified': {
      const { verifiedEmail } = data as { verifiedEmail: string };
      await notifyEmailVerified(telegramId, verifiedEmail);
      break;
    }

    case 'welcome': {
      await notifyWelcome(telegramId);
      break;
    }

    default:
      logger.warn({ type }, 'Unknown notification type');
  }
}

export const notificationService = {
  send: sendTelegramNotification,
  notifyUtxoMergeNeeded,
  notifyUtxoMergeComplete,
  notifyIncomingTransfer,
  notifyOutgoingTransfer,
  notifyWelcome,
  notifyEmailVerified,
  processJob: processNotificationJob,
};
