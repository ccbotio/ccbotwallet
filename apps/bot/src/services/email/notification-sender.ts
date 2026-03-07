/**
 * Notification Email Sender
 *
 * Helper service for sending notification emails using the templates.
 */

import { emailService } from './index.js';
import {
  transactionSentTemplate,
  transactionReceivedTemplate,
  swapCompletedTemplate,
  swapFailedTemplate,
  priceAlertTemplate,
  priceTargetReachedTemplate,
  newLoginAlertTemplate,
  suspiciousActivityTemplate,
  pinChangedTemplate,
  twoFactorEnabledTemplate,
  type TransactionSentProps,
  type TransactionReceivedProps,
  type SwapCompletedProps,
  type SwapFailedProps,
  type PriceAlertProps,
  type PriceTargetReachedProps,
  type NewLoginAlertProps,
  type SuspiciousActivityProps,
  type PasswordChangedProps,
  type TwoFactorEnabledProps,
} from './templates/index.js';
import { logger } from '../../lib/logger.js';

export class NotificationEmailSender {
  /**
   * Send transaction sent notification
   */
  async sendTransactionSentEmail(
    to: string,
    props: TransactionSentProps
  ): Promise<boolean> {
    const subject = `Transaction Sent: ${props.amount} ${props.token}`;
    const html = transactionSentTemplate(props);
    const success = await emailService.sendRawEmail(to, subject, html);

    if (success) {
      logger.info({ to, amount: props.amount, token: props.token }, 'Transaction sent email delivered');
    }

    return success;
  }

  /**
   * Send transaction received notification
   */
  async sendTransactionReceivedEmail(
    to: string,
    props: TransactionReceivedProps
  ): Promise<boolean> {
    const subject = `${props.token} Received: +${props.amount}`;
    const html = transactionReceivedTemplate(props);
    const success = await emailService.sendRawEmail(to, subject, html);

    if (success) {
      logger.info({ to, amount: props.amount, token: props.token }, 'Transaction received email delivered');
    }

    return success;
  }

  /**
   * Send swap completed notification
   */
  async sendSwapCompletedEmail(
    to: string,
    props: SwapCompletedProps
  ): Promise<boolean> {
    const subject = `Swap Completed: ${props.fromToken} to ${props.toToken}`;
    const html = swapCompletedTemplate(props);
    const success = await emailService.sendRawEmail(to, subject, html);

    if (success) {
      logger.info(
        { to, fromToken: props.fromToken, toToken: props.toToken },
        'Swap completed email delivered'
      );
    }

    return success;
  }

  /**
   * Send swap failed notification
   */
  async sendSwapFailedEmail(
    to: string,
    props: SwapFailedProps
  ): Promise<boolean> {
    const subject = `Swap Failed: ${props.fromToken} to ${props.toToken}`;
    const html = swapFailedTemplate(props);
    const success = await emailService.sendRawEmail(to, subject, html);

    if (success) {
      logger.info(
        { to, fromToken: props.fromToken, toToken: props.toToken, reason: props.reason },
        'Swap failed email delivered'
      );
    }

    return success;
  }

  /**
   * Send price alert notification
   */
  async sendPriceAlertEmail(
    to: string,
    props: PriceAlertProps
  ): Promise<boolean> {
    const direction = props.changeDirection === 'up' ? 'Up' : 'Down';
    const subject = `${props.token} Price ${direction}: ${props.changePercent}%`;
    const html = priceAlertTemplate(props);
    const success = await emailService.sendRawEmail(to, subject, html);

    if (success) {
      logger.info(
        { to, token: props.token, changePercent: props.changePercent },
        'Price alert email delivered'
      );
    }

    return success;
  }

  /**
   * Send price target reached notification
   */
  async sendPriceTargetReachedEmail(
    to: string,
    props: PriceTargetReachedProps
  ): Promise<boolean> {
    const subject = `Price Target Reached: ${props.token} at ${props.currentPrice}`;
    const html = priceTargetReachedTemplate(props);
    const success = await emailService.sendRawEmail(to, subject, html);

    if (success) {
      logger.info(
        { to, token: props.token, targetPrice: props.targetPrice },
        'Price target reached email delivered'
      );
    }

    return success;
  }

  /**
   * Send new login alert notification
   */
  async sendNewLoginAlertEmail(
    to: string,
    props: NewLoginAlertProps
  ): Promise<boolean> {
    const subject = 'New Login Detected - CC Bot Wallet';
    const html = newLoginAlertTemplate(props);
    const success = await emailService.sendRawEmail(to, subject, html);

    if (success) {
      logger.info(
        { to, deviceType: props.deviceType, location: props.location },
        'New login alert email delivered'
      );
    }

    return success;
  }

  /**
   * Send suspicious activity alert notification
   */
  async sendSuspiciousActivityEmail(
    to: string,
    props: SuspiciousActivityProps
  ): Promise<boolean> {
    const subject = 'Security Alert - CC Bot Wallet';
    const html = suspiciousActivityTemplate(props);
    const success = await emailService.sendRawEmail(to, subject, html);

    if (success) {
      logger.info(
        { to, activityType: props.activityType },
        'Suspicious activity email delivered'
      );
    }

    return success;
  }

  /**
   * Send PIN changed confirmation notification
   */
  async sendPinChangedEmail(
    to: string,
    props: PasswordChangedProps
  ): Promise<boolean> {
    const subject = 'PIN Changed - CC Bot Wallet';
    const html = pinChangedTemplate(props);
    const success = await emailService.sendRawEmail(to, subject, html);

    if (success) {
      logger.info({ to }, 'PIN changed email delivered');
    }

    return success;
  }

  /**
   * Send 2FA enabled confirmation notification
   */
  async sendTwoFactorEnabledEmail(
    to: string,
    props: TwoFactorEnabledProps
  ): Promise<boolean> {
    const subject = 'Two-Factor Authentication Enabled - CC Bot Wallet';
    const html = twoFactorEnabledTemplate(props);
    const success = await emailService.sendRawEmail(to, subject, html);

    if (success) {
      logger.info({ to, method: props.method }, '2FA enabled email delivered');
    }

    return success;
  }
}

export const notificationEmailSender = new NotificationEmailSender();
