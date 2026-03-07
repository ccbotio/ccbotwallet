/**
 * Email Templates Index
 *
 * Re-exports all email templates for easy importing.
 */

// Base template
export { baseTemplate } from './base.js';
export type { BaseTemplateProps } from './base.js';

// Transaction templates
export {
  transactionSentTemplate,
  transactionReceivedTemplate,
} from './transaction.js';
export type {
  TransactionSentProps,
  TransactionReceivedProps,
} from './transaction.js';

// Swap templates
export { swapCompletedTemplate, swapFailedTemplate } from './swap.js';
export type { SwapCompletedProps, SwapFailedProps } from './swap.js';

// Price alert templates
export {
  priceAlertTemplate,
  priceTargetReachedTemplate,
} from './price-alert.js';
export type { PriceAlertProps, PriceTargetReachedProps } from './price-alert.js';

// Security templates
export {
  newLoginAlertTemplate,
  suspiciousActivityTemplate,
  pinChangedTemplate,
  twoFactorEnabledTemplate,
} from './security.js';
export type {
  NewLoginAlertProps,
  SuspiciousActivityProps,
  PasswordChangedProps,
  TwoFactorEnabledProps,
} from './security.js';
