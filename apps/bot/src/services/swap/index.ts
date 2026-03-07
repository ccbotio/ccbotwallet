/**
 * Swap Service
 *
 * Handles CC <-> USDCx swaps using the Treasury as liquidity provider.
 * Uses Canton's amuletPrice as the price oracle and DvP settlement.
 *
 * Architecture:
 * 1. User requests quote -> Calculate rate using Canton price oracle
 * 2. User executes swap -> Sequential transfer (User->Treasury, Treasury->User)
 * 3. Enhanced safety: Automatic refund if Treasury send fails
 *
 * Settlement Flow:
 * - Step 1: User sends fromToken to Treasury
 * - Step 2: Treasury sends toToken to User
 * - If Step 2 fails: Automatic refund of Step 1
 *
 * Status Flow:
 * pending -> user_sent -> completed (happy path)
 *         -> user_sent -> failed -> refund_pending -> refunded (refund path)
 *         -> user_sent -> failed -> refund_pending -> refund_failed (worst case)
 */

import { OfficialSDKClient, type TokenSymbol } from '@repo/canton-client';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, lt, desc } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { TreasuryService, type TreasuryConfig } from './treasury.js';
import { createLogger } from '@repo/shared/logger';

const logger = createLogger('swap-service');
import {
  alertRefundFailed,
  alertRefundSuccess,
  checkTreasuryBalances,
  checkLargeSwap,
  alertSwapServiceError,
} from '../admin/alerts.js';
import {
  swapQuotesTotal,
  swapExecutionsTotal,
  swapVolume,
  swapDuration,
  swapRefundsTotal,
  updateTreasuryBalance,
  treasuryFeesCollected,
} from '../../lib/metrics.js';

// Re-export treasury
export { TreasuryService, type TreasuryConfig } from './treasury.js';

// ==================== Types ====================

export interface SwapQuoteRequest {
  fromToken: TokenSymbol;
  toToken: TokenSymbol;
  amount: string;
  direction: 'exactIn' | 'exactOut';
}

export interface SwapQuoteResponse {
  quoteId: string;
  fromToken: TokenSymbol;
  toToken: TokenSymbol;
  fromAmount: string;
  toAmount: string;
  rate: string;
  fee: string;
  feePercentage: string;
  ccPriceUsd: string;
  priceImpact: string;
  expiresAt: number;
}

export interface SwapExecuteRequest {
  quoteId: string;
  userShareHex: string;
}

export interface SwapExecuteResponse {
  success: boolean;
  swapId?: string;
  fromAmount?: string;
  toAmount?: string;
  fee?: string;
  userToTreasuryTxHash?: string;
  treasuryToUserTxHash?: string;
  error?: string;
}

export interface SwapHistoryItem {
  id: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  fee: string;
  status: string;
  createdAt: string;
  completedAt?: string;
}

// ==================== Constants ====================

const QUOTE_EXPIRY_SECONDS = 60; // Quotes valid for 60 seconds
const MAX_SLIPPAGE_PERCENT = 1.0; // Maximum 1% price change allowed
const USDCX_PRICE_USD = 1.0; // USDCx is pegged 1:1 to USD

// ==================== Swap Service ====================

export class SwapService {
  private sdk: OfficialSDKClient;
  private db: PostgresJsDatabase<typeof schema>;
  private treasury: TreasuryService;
  private initialized = false;

  constructor(
    sdk: OfficialSDKClient,
    db: PostgresJsDatabase<typeof schema>,
    treasuryConfig: TreasuryConfig
  ) {
    this.sdk = sdk;
    this.db = db;
    this.treasury = new TreasuryService(sdk, db, treasuryConfig);
  }

  /**
   * Initialize swap service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.treasury.initialize();
    this.initialized = true;

    logger.info('Swap service initialized');
  }

  /**
   * Get treasury service instance
   */
  getTreasury(): TreasuryService {
    return this.treasury;
  }

  /**
   * Fetch current CC price from Canton mining rounds
   */
  async getCCPriceUsd(): Promise<number> {
    try {
      const priceInfo = await this.sdk.getCCPrice();
      return priceInfo.amuletPriceUsd;
    } catch (error) {
      logger.warn('Failed to fetch CC price, using fallback', { error, fallbackPrice: 0.16 });
      return 0.16; // Fallback price
    }
  }

  /**
   * Calculate swap quote
   */
  async getQuote(
    userId: string,
    request: SwapQuoteRequest
  ): Promise<SwapQuoteResponse> {
    await this.initialize();

    const { fromToken, toToken, amount, direction } = request;

    // Validate tokens
    if (fromToken === toToken) {
      throw new Error('Cannot swap same token');
    }

    if (!['CC', 'USDCx'].includes(fromToken) || !['CC', 'USDCx'].includes(toToken)) {
      throw new Error('Invalid token pair');
    }

    // Check treasury is active
    const isActive = await this.treasury.isActive();
    if (!isActive) {
      throw new Error('Swap service is currently paused');
    }

    // Get CC price from Canton
    const ccPriceUsd = await this.getCCPriceUsd();
    const config = this.treasury.getConfig();

    // Parse amount
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error('Invalid amount');
    }

    // Check minimum amounts
    if (fromToken === 'CC' && amountNum < config.minSwapAmountCc) {
      throw new Error(`Minimum swap amount is ${config.minSwapAmountCc} CC`);
    }
    if (fromToken === 'USDCx' && amountNum < config.minSwapAmountUsdcx) {
      throw new Error(`Minimum swap amount is ${config.minSwapAmountUsdcx} USDCx`);
    }

    // Check maximum amounts
    if (fromToken === 'CC' && amountNum > config.maxSwapAmountCc) {
      throw new Error(`Maximum swap amount is ${config.maxSwapAmountCc} CC`);
    }
    if (fromToken === 'USDCx' && amountNum > config.maxSwapAmountUsdcx) {
      throw new Error(`Maximum swap amount is ${config.maxSwapAmountUsdcx} USDCx`);
    }

    // Calculate swap amounts
    let fromAmount: number;
    let toAmount: number;
    let fee: number;
    let rate: number;

    if (direction === 'exactIn') {
      fromAmount = amountNum;

      if (fromToken === 'CC') {
        // CC -> USDCx
        const fromAmountUsd = fromAmount * ccPriceUsd;
        fee = fromAmountUsd * (config.feePercentage / 100);
        toAmount = (fromAmountUsd - fee) / USDCX_PRICE_USD;
        rate = ccPriceUsd; // CC/USD rate
      } else {
        // USDCx -> CC
        const fromAmountUsd = fromAmount * USDCX_PRICE_USD;
        fee = fromAmountUsd * (config.feePercentage / 100);
        toAmount = (fromAmountUsd - fee) / ccPriceUsd;
        rate = 1 / ccPriceUsd; // USD/CC rate
      }
    } else {
      // exactOut - calculate fromAmount needed for exact toAmount
      toAmount = amountNum;

      if (fromToken === 'CC') {
        // CC -> USDCx (exact USDCx out)
        const toAmountUsd = toAmount * USDCX_PRICE_USD;
        // Reverse fee calculation: fromUsd - fee = toUsd, so fromUsd = toUsd / (1 - feeRate)
        const fromAmountUsd = toAmountUsd / (1 - config.feePercentage / 100);
        fee = fromAmountUsd - toAmountUsd;
        fromAmount = fromAmountUsd / ccPriceUsd;
        rate = ccPriceUsd;
      } else {
        // USDCx -> CC (exact CC out)
        const toAmountUsd = toAmount * ccPriceUsd;
        const fromAmountUsd = toAmountUsd / (1 - config.feePercentage / 100);
        fee = fromAmountUsd - toAmountUsd;
        fromAmount = fromAmountUsd / USDCX_PRICE_USD;
        rate = 1 / ccPriceUsd;
      }
    }

    // Check treasury has liquidity
    const hasLiquidity = await this.treasury.hasLiquidity(toToken, toAmount);
    if (!hasLiquidity) {
      throw new Error(`Insufficient ${toToken} liquidity`);
    }

    // Calculate price impact (simplified - would be more complex with AMM)
    const priceImpact = 0; // No price impact for fixed-rate swaps

    // Create quote in database
    const expiresAt = new Date(Date.now() + QUOTE_EXPIRY_SECONDS * 1000);

    const [quote] = await this.db.insert(schema.swapQuotes).values({
      userId,
      fromToken,
      toToken,
      fromAmount: fromAmount.toFixed(fromToken === 'CC' ? 10 : 6),
      toAmount: toAmount.toFixed(toToken === 'CC' ? 10 : 6),
      rate: rate.toFixed(6),
      fee: fee.toFixed(6),
      feePercentage: config.feePercentage.toString(),
      ccPriceUsd: ccPriceUsd.toFixed(6),
      status: 'pending',
      expiresAt,
    }).returning();

    logger.info('Quote created', { quoteId: quote!.id, fromToken, toToken, fromAmount: fromAmount.toFixed(6) });

    // Record quote metrics
    swapQuotesTotal.inc({ from_token: fromToken, to_token: toToken });

    return {
      quoteId: quote!.id,
      fromToken,
      toToken,
      fromAmount: fromAmount.toFixed(fromToken === 'CC' ? 10 : 6),
      toAmount: toAmount.toFixed(toToken === 'CC' ? 10 : 6),
      rate: rate.toFixed(6),
      fee: fee.toFixed(6),
      feePercentage: config.feePercentage.toString(),
      ccPriceUsd: ccPriceUsd.toFixed(6),
      priceImpact: priceImpact.toFixed(4),
      expiresAt: expiresAt.getTime(),
    };
  }

  /**
   * Execute a swap using a quote.
   *
   * Settlement Pattern: Enhanced Sequential with Automatic Refund
   *
   * Happy Path:
   *   1. User sends fromToken to Treasury ✓
   *   2. Treasury sends toToken to User ✓
   *   3. Swap completed
   *
   * Failure Path (Treasury send fails):
   *   1. User sends fromToken to Treasury ✓
   *   2. Treasury send fails ✗
   *   3. Automatic refund: Treasury sends fromToken back to User
   *   4. Swap marked as refunded
   *
   * This provides atomic-like guarantees without custom Daml contracts:
   * - Either swap completes fully (user gets toToken)
   * - Or user gets their fromToken back (refund)
   */
  async executeSwap(
    userId: string,
    _walletId: string, // Reserved for future use (e.g., logging)
    userPartyId: string,
    request: SwapExecuteRequest,
    reconstructKey: (userShareHex: string) => Promise<string>
  ): Promise<SwapExecuteResponse> {
    await this.initialize();

    const { quoteId, userShareHex } = request;
    const swapStartTime = Date.now(); // Track swap duration for metrics

    // ========== PHASE 1: VALIDATION ==========

    // Fetch and validate quote
    const [quote] = await this.db
      .select()
      .from(schema.swapQuotes)
      .where(
        and(
          eq(schema.swapQuotes.id, quoteId),
          eq(schema.swapQuotes.userId, userId),
          eq(schema.swapQuotes.status, 'pending')
        )
      )
      .limit(1);

    if (!quote) {
      return { success: false, error: 'Quote not found or already used' };
    }

    // Check expiration
    if (new Date() > quote.expiresAt) {
      await this.db
        .update(schema.swapQuotes)
        .set({ status: 'expired' })
        .where(eq(schema.swapQuotes.id, quoteId));

      return { success: false, error: 'Quote has expired' };
    }

    // Check slippage - compare current price with quote price
    const currentCcPrice = await this.getCCPriceUsd();
    const quoteCcPrice = parseFloat(quote.ccPriceUsd);
    const priceDiff = Math.abs(currentCcPrice - quoteCcPrice) / quoteCcPrice * 100;

    if (priceDiff > MAX_SLIPPAGE_PERCENT) {
      await this.db
        .update(schema.swapQuotes)
        .set({ status: 'cancelled' })
        .where(eq(schema.swapQuotes.id, quoteId));

      return {
        success: false,
        error: `Price has changed by ${priceDiff.toFixed(2)}% (max ${MAX_SLIPPAGE_PERCENT}%)`,
      };
    }

    // ========== PHASE 2: CREATE SWAP RECORD ==========

    // Create swap transaction record with user party for potential refunds
    const [swapTx] = await this.db.insert(schema.swapTransactions).values({
      userId,
      quoteId,
      fromToken: quote.fromToken,
      toToken: quote.toToken,
      fromAmount: quote.fromAmount,
      toAmount: quote.toAmount,
      fee: quote.fee,
      userPartyId, // Store for refund purposes
      status: 'pending',
    }).returning();

    const swapId = swapTx!.id;

    try {
      // Reconstruct user's private key
      const userPrivateKeyHex = await reconstructKey(userShareHex);

      // ========== PHASE 3: USER -> TREASURY TRANSFER ==========

      logger.info('Step 1: User sending to Treasury', { swapId, amount: quote.fromAmount, token: quote.fromToken });

      const userSendResult = await this.sdk.sendToken(
        {
          fromParty: userPartyId,
          toParty: this.treasury.getPartyId(),
          token: quote.fromToken,
          amount: quote.fromAmount,
          memo: `Swap: ${quote.fromToken} -> ${quote.toToken}`,
        },
        userPrivateKeyHex,
        quote.fromToken as TokenSymbol
      );

      // CRITICAL: Update status to 'user_sent' - this marks the point of no return
      // From here, if anything fails, we MUST attempt refund
      await this.db
        .update(schema.swapTransactions)
        .set({
          status: 'user_sent',
          userToTreasuryTxHash: userSendResult.txHash,
        })
        .where(eq(schema.swapTransactions.id, swapId));

      logger.info('User transfer complete', { swapId, txHash: userSendResult.txHash });

      // ========== PHASE 4: TREASURY -> USER TRANSFER (WITH RETRY) ==========

      logger.info('Step 2: Treasury sending to User', { swapId, amount: quote.toAmount, token: quote.toToken });

      // Attempt Treasury send with retry
      const treasurySendResult = await this.attemptTreasurySendWithRetry(
        userPartyId,
        quote.toAmount,
        quote.toToken as TokenSymbol,
        swapId,
        2 // Max 2 retries
      );

      if (!treasurySendResult.success) {
        // ========== PHASE 5A: TREASURY SEND FAILED - INITIATE REFUND ==========
        logger.error('Treasury send failed after retries', new Error(treasurySendResult.error), { swapId });

        // Mark as failed and pending refund
        await this.db
          .update(schema.swapTransactions)
          .set({
            status: 'refund_pending',
            failureReason: `Treasury send failed: ${treasurySendResult.error}`,
            refundReason: 'Treasury transfer failed',
            refundAmount: quote.fromAmount,
          })
          .where(eq(schema.swapTransactions.id, swapId));

        // Attempt automatic refund
        const refundResult = await this.attemptRefundWithRetry(
          userPartyId,
          quote.fromAmount,
          quote.fromToken as TokenSymbol,
          swapId,
          3 // Max 3 refund attempts
        );

        if (refundResult.success) {
          // Refund successful
          await this.db
            .update(schema.swapTransactions)
            .set({
              status: 'refunded',
              refundTxHash: refundResult.txHash,
              refundedAt: new Date(),
            })
            .where(eq(schema.swapTransactions.id, swapId));

          // Cancel the quote
          await this.db
            .update(schema.swapQuotes)
            .set({ status: 'cancelled' })
            .where(eq(schema.swapQuotes.id, quoteId));

          logger.info('Swap failed but user refunded successfully', { swapId });

          // ========== METRICS: REFUNDED SWAP ==========
          const refundDurationMs = Date.now() - swapStartTime;
          swapExecutionsTotal.inc({
            from_token: quote.fromToken,
            to_token: quote.toToken,
            status: 'refunded',
          });
          swapRefundsTotal.inc({ status: 'success', token: quote.fromToken });
          swapDuration.observe(
            { from_token: quote.fromToken, to_token: quote.toToken, status: 'refunded' },
            refundDurationMs / 1000
          );

          // Alert: Refund successful (info level)
          alertRefundSuccess({
            swapId,
            refundAmount: quote.fromAmount,
            refundToken: quote.fromToken,
            txHash: refundResult.txHash || 'unknown',
          }).catch(err => logger.warn('Failed to send refund success alert', { swapId, error: err }));

          return {
            success: false,
            swapId,
            error: 'Swap failed: Treasury transfer failed. Your funds have been refunded.',
          };
        } else {
          // CRITICAL: Refund also failed - this requires manual intervention
          await this.db
            .update(schema.swapTransactions)
            .set({
              status: 'refund_failed',
              failureReason: `Treasury send failed: ${treasurySendResult.error}. Refund also failed: ${refundResult.error}`,
            })
            .where(eq(schema.swapTransactions.id, swapId));

          logger.error('CRITICAL: Both swap and refund failed! Manual intervention required', undefined, { swapId });

          // ========== METRICS: REFUND FAILED ==========
          const failedDurationMs = Date.now() - swapStartTime;
          swapExecutionsTotal.inc({
            from_token: quote.fromToken,
            to_token: quote.toToken,
            status: 'failed',
          });
          swapRefundsTotal.inc({ status: 'failed', token: quote.fromToken });
          swapDuration.observe(
            { from_token: quote.fromToken, to_token: quote.toToken, status: 'failed' },
            failedDurationMs / 1000
          );

          // CRITICAL ALERT: Refund failed - manual intervention required
          alertRefundFailed({
            swapId,
            userId,
            userPartyId,
            refundAmount: quote.fromAmount,
            refundToken: quote.fromToken,
            attempts: 3,
            error: refundResult.error || 'Unknown error',
          }).catch(err => logger.warn('Failed to send refund failed alert', { swapId, error: err }));

          return {
            success: false,
            swapId,
            error: 'Swap failed and automatic refund failed. Support has been notified. Swap ID: ' + swapId,
          };
        }
      }

      // ========== PHASE 5B: SUCCESS - MARK COMPLETED ==========

      await this.db
        .update(schema.swapTransactions)
        .set({
          status: 'completed',
          treasuryToUserTxHash: treasurySendResult.txHash,
          completedAt: new Date(),
        })
        .where(eq(schema.swapTransactions.id, swapId));

      // Mark quote as executed
      await this.db
        .update(schema.swapQuotes)
        .set({
          status: 'executed',
          executedAt: new Date(),
        })
        .where(eq(schema.swapQuotes.id, quoteId));

      // Record fee collection
      await this.treasury.recordSwap(quote.fee, quote.fromToken as TokenSymbol);

      // Sync treasury balances and check for low balance alerts
      this.treasury.syncBalances().then(async () => {
        try {
          const stats = await this.treasury.getStats();
          // Update treasury balance metrics
          updateTreasuryBalance(
            parseFloat(stats.ccReserve),
            parseFloat(stats.usdcxReserve)
          );
          // Check treasury balances and alert if low
          await checkTreasuryBalances({
            cc: stats.ccReserve,
            usdcx: stats.usdcxReserve,
          });
        } catch (err) {
          logger.warn('Failed to check treasury balances', { swapId, error: err });
        }
      }).catch((err) => {
        logger.warn('Failed to sync treasury balances', { swapId, error: err });
      });

      // Check for large swap and alert
      checkLargeSwap({
        swapId,
        userId,
        fromToken: quote.fromToken,
        toToken: quote.toToken,
        fromAmount: quote.fromAmount,
        toAmount: quote.toAmount,
      }).catch(err => logger.warn('Failed to check large swap', { swapId, error: err }));

      logger.info('Swap completed successfully', { swapId });

      // ========== METRICS: SUCCESSFUL SWAP ==========
      const swapDurationMs = Date.now() - swapStartTime;
      swapExecutionsTotal.inc({
        from_token: quote.fromToken,
        to_token: quote.toToken,
        status: 'completed',
      });
      swapVolume.inc(
        { token: quote.fromToken, direction: 'out' },
        parseFloat(quote.fromAmount)
      );
      swapVolume.inc(
        { token: quote.toToken, direction: 'in' },
        parseFloat(quote.toAmount)
      );
      swapDuration.observe(
        { from_token: quote.fromToken, to_token: quote.toToken, status: 'completed' },
        swapDurationMs / 1000
      );
      treasuryFeesCollected.inc({ token: quote.fromToken }, parseFloat(quote.fee));

      const response: SwapExecuteResponse = {
        success: true,
        swapId,
        fromAmount: quote.fromAmount,
        toAmount: quote.toAmount,
        fee: quote.fee,
        userToTreasuryTxHash: userSendResult.txHash,
      };

      if (treasurySendResult.txHash) {
        response.treasuryToUserTxHash = treasurySendResult.txHash;
      }

      return response;
    } catch (error) {
      // ========== PHASE 6: UNEXPECTED ERROR HANDLING ==========
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Unexpected error during swap', error instanceof Error ? error : undefined, { swapId, errorMessage });

      // Alert admins about service error
      alertSwapServiceError({
        operation: 'executeSwap',
        error: errorMessage,
        context: { swapId, userId, fromToken: quote.fromToken, toToken: quote.toToken },
      }).catch(err => logger.warn('Failed to send service error alert', { swapId, error: err }));

      // Check current status to determine if refund is needed
      const [currentSwap] = await this.db
        .select({ status: schema.swapTransactions.status })
        .from(schema.swapTransactions)
        .where(eq(schema.swapTransactions.id, swapId))
        .limit(1);

      if (currentSwap?.status === 'user_sent') {
        // User already sent funds, attempt refund
        logger.info('User funds already sent, attempting refund', { swapId });

        await this.db
          .update(schema.swapTransactions)
          .set({
            status: 'refund_pending',
            failureReason: `Unexpected error: ${errorMessage}`,
            refundReason: 'Unexpected error after user transfer',
            refundAmount: quote.fromAmount,
          })
          .where(eq(schema.swapTransactions.id, swapId));

        const refundResult = await this.attemptRefundWithRetry(
          userPartyId,
          quote.fromAmount,
          quote.fromToken as TokenSymbol,
          swapId,
          3
        );

        if (refundResult.success) {
          await this.db
            .update(schema.swapTransactions)
            .set({
              status: 'refunded',
              refundTxHash: refundResult.txHash,
              refundedAt: new Date(),
            })
            .where(eq(schema.swapTransactions.id, swapId));

          // ========== METRICS: REFUNDED (UNEXPECTED ERROR) ==========
          swapExecutionsTotal.inc({
            from_token: quote.fromToken,
            to_token: quote.toToken,
            status: 'refunded',
          });
          swapRefundsTotal.inc({ status: 'success', token: quote.fromToken });
          swapDuration.observe(
            { from_token: quote.fromToken, to_token: quote.toToken, status: 'refunded' },
            (Date.now() - swapStartTime) / 1000
          );

          return {
            success: false,
            swapId,
            error: 'Swap failed due to unexpected error. Your funds have been refunded.',
          };
        } else {
          await this.db
            .update(schema.swapTransactions)
            .set({ status: 'refund_failed' })
            .where(eq(schema.swapTransactions.id, swapId));

          // ========== METRICS: REFUND FAILED (UNEXPECTED ERROR) ==========
          swapExecutionsTotal.inc({
            from_token: quote.fromToken,
            to_token: quote.toToken,
            status: 'failed',
          });
          swapRefundsTotal.inc({ status: 'failed', token: quote.fromToken });
          swapDuration.observe(
            { from_token: quote.fromToken, to_token: quote.toToken, status: 'failed' },
            (Date.now() - swapStartTime) / 1000
          );

          return {
            success: false,
            swapId,
            error: 'Swap failed and automatic refund failed. Support has been notified. Swap ID: ' + swapId,
          };
        }
      }

      // User funds not yet sent, just mark as failed
      await this.db
        .update(schema.swapTransactions)
        .set({
          status: 'failed',
          failureReason: errorMessage,
        })
        .where(eq(schema.swapTransactions.id, swapId));

      await this.db
        .update(schema.swapQuotes)
        .set({ status: 'cancelled' })
        .where(eq(schema.swapQuotes.id, quoteId));

      // ========== METRICS: EARLY FAILURE ==========
      swapExecutionsTotal.inc({
        from_token: quote.fromToken,
        to_token: quote.toToken,
        status: 'failed',
      });
      swapDuration.observe(
        { from_token: quote.fromToken, to_token: quote.toToken, status: 'failed' },
        (Date.now() - swapStartTime) / 1000
      );

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Attempt Treasury send with retry logic.
   * Uses exponential backoff between retries.
   */
  private async attemptTreasurySendWithRetry(
    userPartyId: string,
    amount: string,
    token: TokenSymbol,
    swapId: string,
    maxRetries: number
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    let lastError: string = 'Unknown error';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s, 4s...
        const delay = Math.pow(2, attempt - 1) * 1000;
        logger.debug('Treasury send retry', { swapId, attempt, maxRetries, delayMs: delay });
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const result = await this.treasury.sendToUser(userPartyId, amount, token);

      if (result.success) {
        return result;
      }

      lastError = result.error || 'Unknown error';
      logger.warn('Treasury send attempt failed', { swapId, attempt: attempt + 1, error: lastError });
    }

    return { success: false, error: lastError };
  }

  /**
   * Attempt refund with retry logic.
   * Uses exponential backoff and tracks attempts in database.
   */
  private async attemptRefundWithRetry(
    userPartyId: string,
    amount: string,
    token: TokenSymbol,
    swapId: string,
    maxRetries: number
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    let lastError: string = 'Unknown error';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Track refund attempts
      await this.db
        .update(schema.swapTransactions)
        .set({ refundAttempts: attempt + 1 })
        .where(eq(schema.swapTransactions.id, swapId));

      if (attempt > 0) {
        // Exponential backoff: 2s, 4s, 8s...
        const delay = Math.pow(2, attempt) * 1000;
        logger.debug('Refund retry', { swapId, attempt, maxRetries, delayMs: delay });
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      logger.info('Refund attempt', { swapId, attempt: attempt + 1, totalAttempts: maxRetries + 1 });

      const result = await this.treasury.issueRefund(userPartyId, amount, token, swapId);

      if (result.success) {
        return result;
      }

      lastError = result.error || 'Unknown error';
      logger.warn('Refund attempt failed', { swapId, attempt: attempt + 1, error: lastError });
    }

    return { success: false, error: lastError };
  }

  /**
   * Get swap history for a user
   */
  async getSwapHistory(
    userId: string,
    limit = 20,
    offset = 0
  ): Promise<{ swaps: SwapHistoryItem[]; total: number }> {
    const swaps = await this.db
      .select()
      .from(schema.swapTransactions)
      .where(eq(schema.swapTransactions.userId, userId))
      .orderBy(desc(schema.swapTransactions.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const allSwaps = await this.db
      .select({ id: schema.swapTransactions.id })
      .from(schema.swapTransactions)
      .where(eq(schema.swapTransactions.userId, userId));

    return {
      swaps: swaps.map((s) => {
        const item: SwapHistoryItem = {
          id: s.id,
          fromToken: s.fromToken,
          toToken: s.toToken,
          fromAmount: s.fromAmount,
          toAmount: s.toAmount,
          fee: s.fee,
          status: s.status,
          createdAt: s.createdAt.toISOString(),
        };

        if (s.completedAt) {
          item.completedAt = s.completedAt.toISOString();
        }

        return item;
      }),
      total: allSwaps.length,
    };
  }

  /**
   * Clean up expired quotes
   */
  async cleanupExpiredQuotes(): Promise<number> {
    // Find and count expired quotes first
    const expiredQuotes = await this.db
      .select({ id: schema.swapQuotes.id })
      .from(schema.swapQuotes)
      .where(
        and(
          eq(schema.swapQuotes.status, 'pending'),
          lt(schema.swapQuotes.expiresAt, new Date())
        )
      );

    if (expiredQuotes.length === 0) {
      return 0;
    }

    // Update them to expired
    await this.db
      .update(schema.swapQuotes)
      .set({ status: 'expired' })
      .where(
        and(
          eq(schema.swapQuotes.status, 'pending'),
          lt(schema.swapQuotes.expiresAt, new Date())
        )
      );

    return expiredQuotes.length;
  }

  /**
   * Get swap service status
   */
  async getStatus(): Promise<{
    isActive: boolean;
    ccPriceUsd: number;
    treasuryStats: Awaited<ReturnType<TreasuryService['getStats']>>;
    config: {
      feePercentage: number;
      maxSwapAmountCc: number;
      maxSwapAmountUsdcx: number;
      minSwapAmountCc: number;
      minSwapAmountUsdcx: number;
      quoteExpirySeconds: number;
      maxSlippagePercent: number;
    };
  }> {
    await this.initialize();

    const isActive = await this.treasury.isActive();
    const ccPriceUsd = await this.getCCPriceUsd();
    const treasuryStats = await this.treasury.getStats();
    const config = this.treasury.getConfig();

    return {
      isActive,
      ccPriceUsd,
      treasuryStats,
      config: {
        feePercentage: config.feePercentage,
        maxSwapAmountCc: config.maxSwapAmountCc,
        maxSwapAmountUsdcx: config.maxSwapAmountUsdcx,
        minSwapAmountCc: config.minSwapAmountCc,
        minSwapAmountUsdcx: config.minSwapAmountUsdcx,
        quoteExpirySeconds: QUOTE_EXPIRY_SECONDS,
        maxSlippagePercent: MAX_SLIPPAGE_PERCENT,
      },
    };
  }
}
