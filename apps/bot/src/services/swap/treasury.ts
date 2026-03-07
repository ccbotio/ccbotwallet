/**
 * Treasury Service
 *
 * Manages the treasury party that provides liquidity for CC <-> USDCx swaps.
 * The treasury holds reserves of both tokens and executes DvP settlements.
 *
 * SECURITY: Treasury private key must be stored securely (HSM in production).
 */

import { OfficialSDKClient, type TokenSymbol } from '@repo/canton-client';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { createLogger } from '@repo/shared/logger';

const logger = createLogger('treasury');

export interface TreasuryConfig {
  partyId: string;
  privateKeyHex: string;
  feePercentage: number;
  maxSwapAmountCc: number;
  maxSwapAmountUsdcx: number;
  minSwapAmountCc: number;
  minSwapAmountUsdcx: number;
}

export interface TreasuryBalances {
  cc: string;
  usdcx: string;
  ccLocked: string;
  usdcxLocked: string;
}

export class TreasuryService {
  private sdk: OfficialSDKClient;
  private db: PostgresJsDatabase<typeof schema>;
  private config: TreasuryConfig;
  private initialized = false;

  constructor(
    sdk: OfficialSDKClient,
    db: PostgresJsDatabase<typeof schema>,
    config: TreasuryConfig
  ) {
    this.sdk = sdk;
    this.db = db;
    this.config = config;
  }

  /**
   * Initialize treasury state in database if not exists
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Check if treasury state exists
    const existing = await this.db
      .select()
      .from(schema.treasuryState)
      .where(eq(schema.treasuryState.partyId, this.config.partyId))
      .limit(1);

    if (existing.length === 0) {
      // Create treasury state
      await this.db.insert(schema.treasuryState).values({
        partyId: this.config.partyId,
        feePercentage: this.config.feePercentage.toString(),
        maxSwapAmountCc: this.config.maxSwapAmountCc.toString(),
        maxSwapAmountUsdcx: this.config.maxSwapAmountUsdcx.toString(),
        minSwapAmountCc: this.config.minSwapAmountCc.toString(),
        minSwapAmountUsdcx: this.config.minSwapAmountUsdcx.toString(),
      });

      logger.info('Initialized treasury state in database');
    }

    // Sync balances from Canton
    await this.syncBalances();

    this.initialized = true;
    logger.info('Treasury service initialized');
  }

  /**
   * Get treasury configuration
   */
  getConfig(): TreasuryConfig {
    return this.config;
  }

  /**
   * Get treasury party ID
   */
  getPartyId(): string {
    return this.config.partyId;
  }

  /**
   * Get treasury private key (SECURITY: Use with caution)
   */
  getPrivateKeyHex(): string {
    return this.config.privateKeyHex;
  }

  /**
   * Sync treasury balances from Canton ledger to database
   */
  async syncBalances(): Promise<TreasuryBalances> {
    logger.debug('Syncing balances from Canton');

    const balances = await this.sdk.getAllBalances(this.config.partyId);

    const treasuryBalances: TreasuryBalances = {
      cc: balances.cc.amount,
      usdcx: balances.usdcx.amount,
      ccLocked: balances.cc.locked,
      usdcxLocked: balances.usdcx.locked,
    };

    // Update database
    await this.db
      .update(schema.treasuryState)
      .set({
        ccReserve: treasuryBalances.cc,
        usdcxReserve: treasuryBalances.usdcx,
        updatedAt: new Date(),
      })
      .where(eq(schema.treasuryState.partyId, this.config.partyId));

    logger.debug('Balances synced', { cc: treasuryBalances.cc, usdcx: treasuryBalances.usdcx });
    return treasuryBalances;
  }

  /**
   * Get current treasury balances from database
   */
  async getBalances(): Promise<TreasuryBalances> {
    const state = await this.db
      .select()
      .from(schema.treasuryState)
      .where(eq(schema.treasuryState.partyId, this.config.partyId))
      .limit(1);

    if (state.length === 0) {
      return { cc: '0', usdcx: '0', ccLocked: '0', usdcxLocked: '0' };
    }

    return {
      cc: state[0]!.ccReserve,
      usdcx: state[0]!.usdcxReserve,
      ccLocked: '0', // Not tracked in DB, would need Canton query
      usdcxLocked: '0',
    };
  }

  /**
   * Check if treasury is active and can process swaps
   */
  async isActive(): Promise<boolean> {
    const state = await this.db
      .select({ isActive: schema.treasuryState.isActive })
      .from(schema.treasuryState)
      .where(eq(schema.treasuryState.partyId, this.config.partyId))
      .limit(1);

    return state.length > 0 && state[0]!.isActive;
  }

  /**
   * Check if treasury has sufficient liquidity for a swap
   */
  async hasLiquidity(token: TokenSymbol, amount: number): Promise<boolean> {
    const balances = await this.getBalances();

    if (token === 'CC') {
      return parseFloat(balances.cc) >= amount;
    } else {
      return parseFloat(balances.usdcx) >= amount;
    }
  }

  /**
   * Send tokens from treasury to a user
   */
  async sendToUser(
    toPartyId: string,
    amount: string,
    token: TokenSymbol
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    logger.info('Sending tokens to user', { toPartyId, amount, token });

    try {
      const result = await this.sdk.sendToken(
        {
          fromParty: this.config.partyId,
          toParty: toPartyId,
          token,
          amount,
          memo: `Swap settlement: ${token}`,
        },
        this.config.privateKeyHex,
        token
      );

      logger.info('Sent tokens successfully', { amount, token, txHash: result.txHash });

      return {
        success: true,
        txHash: result.txHash,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to send tokens', error instanceof Error ? error : undefined, { amount, token, toPartyId });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Update treasury stats after a swap
   */
  async recordSwap(feeAmount: string, feeToken: TokenSymbol): Promise<void> {
    const state = await this.db
      .select()
      .from(schema.treasuryState)
      .where(eq(schema.treasuryState.partyId, this.config.partyId))
      .limit(1);

    if (state.length === 0) return;

    const current = state[0]!;
    const feeNum = parseFloat(feeAmount);

    if (feeToken === 'CC') {
      const newFees = parseFloat(current.totalFeesCollectedCc) + feeNum;
      await this.db
        .update(schema.treasuryState)
        .set({
          totalSwapsCount: current.totalSwapsCount + 1,
          totalFeesCollectedCc: newFees.toString(),
          lastSwapAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.treasuryState.partyId, this.config.partyId));
    } else {
      const newFees = parseFloat(current.totalFeesCollectedUsdcx) + feeNum;
      await this.db
        .update(schema.treasuryState)
        .set({
          totalSwapsCount: current.totalSwapsCount + 1,
          totalFeesCollectedUsdcx: newFees.toString(),
          lastSwapAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.treasuryState.partyId, this.config.partyId));
    }
  }

  /**
   * Issue a refund to a user after a failed swap.
   * This is called when Treasury->User transfer fails after User->Treasury succeeded.
   *
   * @param toPartyId - User's party ID to refund to
   * @param amount - Amount to refund (same as user sent)
   * @param token - Token type that was sent by user
   * @param swapId - Swap transaction ID for logging
   * @returns Refund result with txHash or error
   */
  async issueRefund(
    toPartyId: string,
    amount: string,
    token: TokenSymbol,
    swapId: string
  ): Promise<{ success: boolean; txHash?: string; error?: string }> {
    logger.info('Issuing refund', { swapId, amount, token, toPartyId });

    try {
      // Verify we have the funds to refund (we should, since user just sent them)
      const hasBalance = await this.hasLiquidity(token, parseFloat(amount));
      if (!hasBalance) {
        const error = `Insufficient ${token} balance for refund`;
        logger.error('Refund failed - insufficient balance', undefined, { swapId, token, amount });
        return { success: false, error };
      }

      const result = await this.sdk.sendToken(
        {
          fromParty: this.config.partyId,
          toParty: toPartyId,
          token,
          amount,
          memo: `Refund for failed swap ${swapId}`,
        },
        this.config.privateKeyHex,
        token
      );

      logger.info('Refund successful', { swapId, txHash: result.txHash });

      return {
        success: true,
        txHash: result.txHash,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Refund failed', error instanceof Error ? error : undefined, { swapId });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Pause treasury (stop accepting swaps)
   */
  async pause(reason: string): Promise<void> {
    await this.db
      .update(schema.treasuryState)
      .set({
        isActive: false,
        pausedReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(schema.treasuryState.partyId, this.config.partyId));

    logger.info('Treasury paused', { reason });
  }

  /**
   * Resume treasury operations
   */
  async resume(): Promise<void> {
    await this.db
      .update(schema.treasuryState)
      .set({
        isActive: true,
        pausedReason: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.treasuryState.partyId, this.config.partyId));

    logger.info('Treasury resumed');
  }

  /**
   * Get treasury statistics
   */
  async getStats(): Promise<{
    totalSwaps: number;
    totalFeesCc: string;
    totalFeesUsdcx: string;
    ccReserve: string;
    usdcxReserve: string;
    isActive: boolean;
    lastSwapAt: Date | null;
  }> {
    const state = await this.db
      .select()
      .from(schema.treasuryState)
      .where(eq(schema.treasuryState.partyId, this.config.partyId))
      .limit(1);

    if (state.length === 0) {
      return {
        totalSwaps: 0,
        totalFeesCc: '0',
        totalFeesUsdcx: '0',
        ccReserve: '0',
        usdcxReserve: '0',
        isActive: false,
        lastSwapAt: null,
      };
    }

    const s = state[0]!;
    return {
      totalSwaps: s.totalSwapsCount,
      totalFeesCc: s.totalFeesCollectedCc,
      totalFeesUsdcx: s.totalFeesCollectedUsdcx,
      ccReserve: s.ccReserve,
      usdcxReserve: s.usdcxReserve,
      isActive: s.isActive,
      lastSwapAt: s.lastSwapAt,
    };
  }
}
