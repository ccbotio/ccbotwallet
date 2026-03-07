/**
 * Admin Alerting Service
 *
 * Sends critical alerts to admin Telegram accounts for:
 * - Swap failures (user funds at risk)
 * - Refund failures (manual intervention needed)
 * - Treasury low balance warnings
 * - Large swap volume alerts
 * - System errors
 *
 * Features:
 * - Rate limiting to prevent spam
 * - Priority levels (critical, warning, info)
 * - Audit logging
 */

import { bot } from '../../bot/index.js';
import { logger } from '../../lib/logger.js';
import { getRedisClient } from '../../lib/redis.js';
import { recordAlert } from '../../lib/metrics.js';

// Alert priority levels
export type AlertPriority = 'critical' | 'warning' | 'info';

// Alert types
export type AlertType =
  | 'swap_failed'
  | 'refund_failed'
  | 'refund_success'
  | 'treasury_low_balance'
  | 'treasury_depleted'
  | 'large_swap'
  | 'swap_service_error'
  | 'bridge_failed'
  | 'system_error';

export interface AdminAlert {
  type: AlertType;
  priority: AlertPriority;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp?: Date;
}

// Alert configuration
const ALERT_CONFIG = {
  // Rate limit: max alerts per type per hour
  rateLimitPerHour: {
    critical: 100,  // Don't rate limit critical alerts much
    warning: 20,
    info: 10,
  },
  // Cooldown between same alert type (seconds)
  cooldownSeconds: {
    critical: 10,
    warning: 60,
    info: 300,
  },
  // Treasury thresholds
  treasury: {
    lowBalanceThresholdCc: 100,      // Warn when CC < 100
    lowBalanceThresholdUsdcx: 100,   // Warn when USDCx < 100
    depletedThreshold: 10,            // Critical when < 10
  },
  // Large swap threshold
  largeSwapThresholdCc: 1000,
  largeSwapThresholdUsdcx: 1000,
};

// Priority emoji mapping
const PRIORITY_EMOJI: Record<AlertPriority, string> = {
  critical: '🚨',
  warning: '⚠️',
  info: 'ℹ️',
};

// Type emoji mapping
const TYPE_EMOJI: Record<AlertType, string> = {
  swap_failed: '❌',
  refund_failed: '💸',
  refund_success: '✅',
  treasury_low_balance: '📉',
  treasury_depleted: '🔴',
  large_swap: '📊',
  swap_service_error: '🔧',
  bridge_failed: '🌉',
  system_error: '💥',
};

/**
 * Get admin Telegram IDs from environment
 */
function getAdminIds(): string[] {
  const adminIds = process.env.ADMIN_TELEGRAM_IDS || '';
  if (!adminIds) {
    return [];
  }
  return adminIds.split(',').map(id => id.trim()).filter(id => id.length > 0);
}

/**
 * Check rate limit for alert type
 */
async function checkRateLimit(alertType: AlertType, priority: AlertPriority): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const key = `admin_alert_rate:${alertType}`;
    const cooldownKey = `admin_alert_cooldown:${alertType}`;

    // Check cooldown first
    const inCooldown = await redis.get(cooldownKey);
    if (inCooldown) {
      logger.debug({ alertType }, 'Alert in cooldown period');
      return false;
    }

    // Check rate limit
    const count = await redis.incr(key);
    if (count === 1) {
      // Set expiry for rate limit window (1 hour)
      await redis.expire(key, 3600);
    }

    const limit = ALERT_CONFIG.rateLimitPerHour[priority];
    if (count > limit) {
      logger.warn({ alertType, count, limit }, 'Alert rate limit exceeded');
      return false;
    }

    // Set cooldown
    const cooldown = ALERT_CONFIG.cooldownSeconds[priority];
    await redis.set(cooldownKey, '1', 'EX', cooldown);

    return true;
  } catch (error) {
    // If Redis fails, allow the alert
    logger.error({ err: error }, 'Rate limit check failed, allowing alert');
    return true;
  }
}

/**
 * Format alert message for Telegram
 */
function formatAlertMessage(alert: AdminAlert): string {
  const priorityEmoji = PRIORITY_EMOJI[alert.priority];
  const typeEmoji = TYPE_EMOJI[alert.type] || '📢';
  const timestamp = (alert.timestamp || new Date()).toISOString();

  let message = `${priorityEmoji} *${alert.priority.toUpperCase()}* ${typeEmoji}\n\n`;
  message += `*${alert.title}*\n\n`;
  message += `${alert.message}\n\n`;

  // Add data details if present
  if (alert.data && Object.keys(alert.data).length > 0) {
    message += `*Details:*\n`;
    for (const [key, value] of Object.entries(alert.data)) {
      const displayKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
      message += `• ${displayKey}: \`${String(value)}\`\n`;
    }
    message += '\n';
  }

  message += `_${timestamp}_`;

  return message;
}

/**
 * Send alert to all admin accounts
 */
async function sendAlertToAdmins(alert: AdminAlert): Promise<{ sent: number; failed: number }> {
  const adminIds = getAdminIds();

  if (adminIds.length === 0) {
    logger.warn('No admin Telegram IDs configured (ADMIN_TELEGRAM_IDS)');
    return { sent: 0, failed: 0 };
  }

  const message = formatAlertMessage(alert);
  let sent = 0;
  let failed = 0;

  for (const adminId of adminIds) {
    try {
      await bot.api.sendMessage(adminId, message, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
      });
      sent++;
    } catch (error) {
      logger.error({ err: error, adminId }, 'Failed to send admin alert');
      failed++;
    }
  }

  return { sent, failed };
}

/**
 * Log alert to audit log
 */
function logAlert(alert: AdminAlert, result: { sent: number; failed: number }): void {
  logger.info(
    {
      alertType: alert.type,
      priority: alert.priority,
      title: alert.title,
      data: alert.data,
      sent: result.sent,
      failed: result.failed,
    },
    `Admin alert: ${alert.title}`
  );
}

/**
 * Send an admin alert
 */
export async function sendAdminAlert(alert: AdminAlert): Promise<boolean> {
  alert.timestamp = alert.timestamp || new Date();

  // Check rate limit
  const allowed = await checkRateLimit(alert.type, alert.priority);
  if (!allowed) {
    // Record rate-limited alert in metrics
    recordAlert(alert.type, alert.priority, false);
    return false;
  }

  // Send to admins
  const result = await sendAlertToAdmins(alert);

  // Log the alert
  logAlert(alert, result);

  // Record alert in metrics
  const sent = result.sent > 0;
  recordAlert(alert.type, alert.priority, sent);

  return sent;
}

// ==================== Specific Alert Functions ====================

/**
 * Alert: Swap failed
 */
export async function alertSwapFailed(params: {
  swapId: string;
  userId: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  error: string;
}): Promise<void> {
  await sendAdminAlert({
    type: 'swap_failed',
    priority: 'critical',
    title: 'Swap Failed',
    message: `A swap transaction has failed. User funds may need manual refund.`,
    data: {
      swapId: params.swapId,
      userId: params.userId,
      swap: `${params.fromAmount} ${params.fromToken} → ${params.toToken}`,
      error: params.error,
    },
  });
}

/**
 * Alert: Refund failed
 */
export async function alertRefundFailed(params: {
  swapId: string;
  userId: string;
  userPartyId: string;
  refundAmount: string;
  refundToken: string;
  attempts: number;
  error: string;
}): Promise<void> {
  await sendAdminAlert({
    type: 'refund_failed',
    priority: 'critical',
    title: 'Refund Failed - Manual Intervention Required',
    message: `Automatic refund has failed after ${params.attempts} attempts. MANUAL REFUND REQUIRED.`,
    data: {
      swapId: params.swapId,
      userId: params.userId,
      userPartyId: params.userPartyId,
      refund: `${params.refundAmount} ${params.refundToken}`,
      attempts: params.attempts,
      error: params.error,
    },
  });
}

/**
 * Alert: Refund successful
 */
export async function alertRefundSuccess(params: {
  swapId: string;
  refundAmount: string;
  refundToken: string;
  txHash: string;
}): Promise<void> {
  await sendAdminAlert({
    type: 'refund_success',
    priority: 'info',
    title: 'Refund Completed',
    message: `Automatic refund was successful.`,
    data: {
      swapId: params.swapId,
      refund: `${params.refundAmount} ${params.refundToken}`,
      txHash: params.txHash,
    },
  });
}

/**
 * Alert: Treasury low balance
 */
export async function alertTreasuryLowBalance(params: {
  token: string;
  balance: string;
  threshold: number;
}): Promise<void> {
  const isDepleted = parseFloat(params.balance) < ALERT_CONFIG.treasury.depletedThreshold;

  await sendAdminAlert({
    type: isDepleted ? 'treasury_depleted' : 'treasury_low_balance',
    priority: isDepleted ? 'critical' : 'warning',
    title: isDepleted ? 'Treasury Depleted!' : 'Treasury Low Balance',
    message: isDepleted
      ? `Treasury ${params.token} balance is critically low. Swap service may fail.`
      : `Treasury ${params.token} balance is below threshold. Consider topping up.`,
    data: {
      token: params.token,
      currentBalance: params.balance,
      threshold: params.threshold,
    },
  });
}

/**
 * Alert: Large swap detected
 */
export async function alertLargeSwap(params: {
  swapId: string;
  userId: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
}): Promise<void> {
  await sendAdminAlert({
    type: 'large_swap',
    priority: 'info',
    title: 'Large Swap Detected',
    message: `A large swap transaction was executed.`,
    data: {
      swapId: params.swapId,
      userId: params.userId,
      swap: `${params.fromAmount} ${params.fromToken} → ${params.toAmount} ${params.toToken}`,
    },
  });
}

/**
 * Alert: Swap service error
 */
export async function alertSwapServiceError(params: {
  operation: string;
  error: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  await sendAdminAlert({
    type: 'swap_service_error',
    priority: 'warning',
    title: 'Swap Service Error',
    message: `An error occurred in the swap service.`,
    data: {
      operation: params.operation,
      error: params.error,
      ...params.context,
    },
  });
}

/**
 * Alert: Bridge transaction failed
 */
export async function alertBridgeFailed(params: {
  bridgeId: string;
  userId: string;
  type: 'deposit' | 'withdrawal';
  amount: string;
  error: string;
}): Promise<void> {
  await sendAdminAlert({
    type: 'bridge_failed',
    priority: 'warning',
    title: `Bridge ${params.type === 'deposit' ? 'Deposit' : 'Withdrawal'} Failed`,
    message: `A bridge transaction has failed.`,
    data: {
      bridgeId: params.bridgeId,
      userId: params.userId,
      type: params.type,
      amount: params.amount,
      error: params.error,
    },
  });
}

/**
 * Alert: System error
 */
export async function alertSystemError(params: {
  component: string;
  error: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  await sendAdminAlert({
    type: 'system_error',
    priority: 'critical',
    title: 'System Error',
    message: `A critical system error has occurred.`,
    data: {
      component: params.component,
      error: params.error,
      ...params.context,
    },
  });
}

// ==================== Treasury Monitoring ====================

/**
 * Check treasury balances and alert if low
 */
export async function checkTreasuryBalances(balances: {
  cc: string;
  usdcx: string;
}): Promise<void> {
  const ccBalance = parseFloat(balances.cc);
  const usdcxBalance = parseFloat(balances.usdcx);

  if (ccBalance < ALERT_CONFIG.treasury.lowBalanceThresholdCc) {
    await alertTreasuryLowBalance({
      token: 'CC',
      balance: balances.cc,
      threshold: ALERT_CONFIG.treasury.lowBalanceThresholdCc,
    });
  }

  if (usdcxBalance < ALERT_CONFIG.treasury.lowBalanceThresholdUsdcx) {
    await alertTreasuryLowBalance({
      token: 'USDCx',
      balance: balances.usdcx,
      threshold: ALERT_CONFIG.treasury.lowBalanceThresholdUsdcx,
    });
  }
}

/**
 * Check if swap amount is large and alert
 */
export async function checkLargeSwap(params: {
  swapId: string;
  userId: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
}): Promise<void> {
  const amount = parseFloat(params.fromAmount);
  const threshold =
    params.fromToken === 'CC'
      ? ALERT_CONFIG.largeSwapThresholdCc
      : ALERT_CONFIG.largeSwapThresholdUsdcx;

  if (amount >= threshold) {
    await alertLargeSwap(params);
  }
}

// Export alert config for external use
export { ALERT_CONFIG };

// Export service object
export const adminAlertService = {
  send: sendAdminAlert,
  alertSwapFailed,
  alertRefundFailed,
  alertRefundSuccess,
  alertTreasuryLowBalance,
  alertLargeSwap,
  alertSwapServiceError,
  alertBridgeFailed,
  alertSystemError,
  checkTreasuryBalances,
  checkLargeSwap,
};

export default adminAlertService;
