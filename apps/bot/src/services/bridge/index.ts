/**
 * Bridge Service
 *
 * Manages USDC <-> USDCx bridge transactions via Circle xReserve.
 * Tracks transaction lifecycle and polls for attestations.
 *
 * Deposit Flow (Ethereum → Canton):
 *   1. User deposits USDC on Ethereum to xReserve contract
 *   2. Ethereum tx is confirmed
 *   3. Circle creates attestation
 *   4. System detects attestation and mints USDCx on Canton
 *
 * Withdrawal Flow (Canton → Ethereum):
 *   1. User burns USDCx on Canton (creates BurnIntent)
 *   2. Circle detects burn and creates attestation
 *   3. Circle releases USDC on Ethereum
 */

import { eq, and, desc, or, isNotNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import type { OfficialSDKClient } from '@repo/canton-client';
import {
  bridgeTransactionsTotal,
  bridgeVolume,
  bridgeAttestationDuration,
} from '../../lib/metrics.js';

/**
 * Determine if we're on testnet based on CANTON_NETWORK env var.
 */
function isTestnetNetwork(): boolean {
  return env.CANTON_NETWORK !== 'mainnet';
}

// Bridge transaction status types
export type BridgeStatus =
  // Deposit statuses
  | 'deposit_initiated'
  | 'eth_tx_pending'
  | 'eth_tx_confirmed'
  | 'attestation_pending'
  | 'attestation_received'
  | 'mint_pending'
  | 'mint_completed'
  // Withdrawal statuses
  | 'withdrawal_initiated'
  | 'burn_pending'
  | 'burn_completed'
  | 'eth_release_pending'
  | 'eth_release_completed'
  // Final statuses
  | 'completed'
  | 'failed';

export type BridgeType = 'deposit' | 'withdrawal';
export type ChainType = 'ethereum' | 'canton';

// Circle Attestation API response
interface CircleAttestationResponse {
  attestation: string | null;
  status: 'pending_confirmations' | 'complete';
}

// Circle xReserve API configuration
const CIRCLE_API_CONFIG = {
  testnet: {
    baseUrl: 'https://iris-api-sandbox.circle.com',
    attestationEndpoint: '/v1/attestations',
  },
  mainnet: {
    baseUrl: 'https://iris-api.circle.com',
    attestationEndpoint: '/v1/attestations',
  },
};

export interface CreateDepositParams {
  userId: string;
  walletId?: string | undefined;
  cantonPartyId: string;
  fromAmount: string;
  fromAddress: string;
  ethTxHash: string;
  fee?: string | undefined;
}

export interface CreateWithdrawalParams {
  userId: string;
  walletId?: string;
  cantonPartyId: string;
  fromAmount: string;
  toAddress: string;
  burnIntentCid?: string;
  cantonTxHash?: string;
  fee?: string;
}

export interface BridgeHistoryParams {
  userId: string;
  type?: BridgeType | undefined;
  status?: BridgeStatus | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export class BridgeService {
  private db: PostgresJsDatabase<typeof schema>;
  private sdk: OfficialSDKClient | undefined; // Reserved for future minting operations
  private isTestnet: boolean;

  constructor(
    db: PostgresJsDatabase<typeof schema>,
    sdk: OfficialSDKClient | undefined,
    isTestnet?: boolean
  ) {
    this.db = db;
    this.sdk = sdk;
    // Use provided value or derive from environment
    this.isTestnet = isTestnet ?? isTestnetNetwork();

    logger.info({
      network: env.CANTON_NETWORK,
      isTestnet: this.isTestnet
    }, 'BridgeService initialized');
  }

  /**
   * Get SDK instance (for minting operations).
   * Returns undefined if not initialized.
   */
  getSDK(): OfficialSDKClient | undefined {
    return this.sdk;
  }

  /**
   * Create a new deposit transaction record.
   * Called after user submits deposit tx on Ethereum.
   */
  async createDeposit(params: CreateDepositParams): Promise<schema.BridgeTransaction> {
    const { userId, walletId, cantonPartyId, fromAmount, fromAddress, ethTxHash, fee } = params;

    logger.info({ userId, ethTxHash, fromAmount }, 'Creating deposit transaction');

    const [tx] = await this.db.insert(schema.bridgeTransactions).values({
      userId,
      walletId,
      type: 'deposit',
      fromChain: 'ethereum',
      toChain: 'canton',
      fromAmount,
      fee,
      fromAddress,
      cantonPartyId,
      ethTxHash,
      status: 'eth_tx_pending',
      attestationStatus: 'pending',
    }).returning();

    logger.info({ bridgeId: tx!.id, ethTxHash }, 'Deposit transaction created');

    // Record metrics
    bridgeTransactionsTotal.inc({ type: 'deposit', status: 'initiated' });
    bridgeVolume.inc({ type: 'deposit' }, parseFloat(fromAmount));

    return tx!;
  }

  /**
   * Create a new withdrawal transaction record.
   * Called when user initiates withdrawal from Canton.
   */
  async createWithdrawal(params: CreateWithdrawalParams): Promise<schema.BridgeTransaction> {
    const { userId, walletId, cantonPartyId, fromAmount, toAddress, burnIntentCid, cantonTxHash, fee } = params;

    logger.info({ userId, toAddress, fromAmount }, 'Creating withdrawal transaction');

    const [tx] = await this.db.insert(schema.bridgeTransactions).values({
      userId,
      walletId,
      type: 'withdrawal',
      fromChain: 'canton',
      toChain: 'ethereum',
      fromAmount,
      fee,
      toAddress,
      cantonPartyId,
      burnIntentCid,
      cantonTxHash,
      status: 'burn_pending',
      attestationStatus: 'pending',
    }).returning();

    logger.info({ bridgeId: tx!.id, burnIntentCid }, 'Withdrawal transaction created');

    // Record metrics
    bridgeTransactionsTotal.inc({ type: 'withdrawal', status: 'initiated' });
    bridgeVolume.inc({ type: 'withdrawal' }, parseFloat(fromAmount));

    return tx!;
  }

  /**
   * Update deposit status after Ethereum tx is confirmed.
   */
  async confirmEthereumTx(
    bridgeId: string,
    blockNumber: number,
    confirmations: number
  ): Promise<void> {
    logger.info({ bridgeId, blockNumber, confirmations }, 'Confirming Ethereum tx');

    await this.db.update(schema.bridgeTransactions)
      .set({
        status: 'eth_tx_confirmed',
        ethBlockNumber: blockNumber,
        ethConfirmations: confirmations,
        updatedAt: new Date(),
      })
      .where(eq(schema.bridgeTransactions.id, bridgeId));

    // Transition to attestation_pending
    await this.db.update(schema.bridgeTransactions)
      .set({
        status: 'attestation_pending',
        updatedAt: new Date(),
      })
      .where(eq(schema.bridgeTransactions.id, bridgeId));
  }

  /**
   * Update withdrawal status after Canton burn is completed.
   */
  async confirmBurn(
    bridgeId: string,
    burnIntentCid: string,
    cantonTxHash: string
  ): Promise<void> {
    logger.info({ bridgeId, burnIntentCid }, 'Confirming Canton burn');

    await this.db.update(schema.bridgeTransactions)
      .set({
        status: 'burn_completed',
        burnIntentCid,
        cantonTxHash,
        updatedAt: new Date(),
      })
      .where(eq(schema.bridgeTransactions.id, bridgeId));

    // Transition to attestation_pending
    await this.db.update(schema.bridgeTransactions)
      .set({
        status: 'attestation_pending',
        updatedAt: new Date(),
      })
      .where(eq(schema.bridgeTransactions.id, bridgeId));
  }

  /**
   * Poll Circle API for attestation status.
   * Returns the attestation hash if available.
   */
  async pollAttestation(
    txHash: string,
    type: BridgeType
  ): Promise<{ status: 'pending' | 'complete'; attestation?: string }> {
    const config = this.isTestnet ? CIRCLE_API_CONFIG.testnet : CIRCLE_API_CONFIG.mainnet;

    try {
      // Circle uses message hash to look up attestations
      // For deposits: use Ethereum tx hash
      // For withdrawals: use the burn message hash from Canton
      const messageHash = txHash;

      const url = `${config.baseUrl}${config.attestationEndpoint}/${messageHash}`;

      logger.debug({ url, type }, 'Polling Circle attestation API');

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          // Circle API may require authentication
          // 'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          // Attestation not yet created
          return { status: 'pending' };
        }
        throw new Error(`Circle API error: ${response.status}`);
      }

      const data = await response.json() as CircleAttestationResponse;

      if (data.status === 'complete' && data.attestation) {
        return {
          status: 'complete',
          attestation: data.attestation,
        };
      }

      return { status: 'pending' };
    } catch (error) {
      logger.error({ err: error, txHash }, 'Failed to poll attestation');
      return { status: 'pending' };
    }
  }

  /**
   * Update transaction with received attestation.
   */
  async receiveAttestation(bridgeId: string, attestationHash: string): Promise<void> {
    logger.info({ bridgeId, attestationHash: attestationHash.slice(0, 20) + '...' }, 'Attestation received');

    await this.db.update(schema.bridgeTransactions)
      .set({
        status: 'attestation_received',
        attestationHash,
        attestationStatus: 'complete',
        attestationReceivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.bridgeTransactions.id, bridgeId));
  }

  /**
   * Mark deposit as mint pending (USDCx minting in progress).
   */
  async startMint(bridgeId: string, depositAttestationCid: string): Promise<void> {
    logger.info({ bridgeId, depositAttestationCid }, 'Starting USDCx mint');

    await this.db.update(schema.bridgeTransactions)
      .set({
        status: 'mint_pending',
        depositAttestationCid,
        updatedAt: new Date(),
      })
      .where(eq(schema.bridgeTransactions.id, bridgeId));
  }

  /**
   * Complete deposit (USDCx minted successfully).
   */
  async completeMint(
    bridgeId: string,
    cantonTxHash: string,
    toAmount: string
  ): Promise<void> {
    logger.info({ bridgeId, cantonTxHash, toAmount }, 'Mint completed');

    // Get transaction to calculate attestation duration
    const tx = await this.getById(bridgeId);

    await this.db.update(schema.bridgeTransactions)
      .set({
        status: 'completed',
        cantonTxHash,
        toAmount,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.bridgeTransactions.id, bridgeId));

    // Record metrics
    bridgeTransactionsTotal.inc({ type: 'deposit', status: 'completed' });
    if (tx?.attestationReceivedAt && tx?.createdAt) {
      const durationSeconds = (tx.attestationReceivedAt.getTime() - tx.createdAt.getTime()) / 1000;
      bridgeAttestationDuration.observe({ type: 'deposit' }, durationSeconds);
    }
  }

  /**
   * Complete withdrawal (USDC released on Ethereum).
   */
  async completeWithdrawal(
    bridgeId: string,
    ethTxHash: string,
    toAmount: string
  ): Promise<void> {
    logger.info({ bridgeId, ethTxHash, toAmount }, 'Withdrawal completed');

    // Get transaction to calculate attestation duration
    const tx = await this.getById(bridgeId);

    await this.db.update(schema.bridgeTransactions)
      .set({
        status: 'completed',
        ethTxHash,
        toAmount,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.bridgeTransactions.id, bridgeId));

    // Record metrics
    bridgeTransactionsTotal.inc({ type: 'withdrawal', status: 'completed' });
    if (tx?.attestationReceivedAt && tx?.createdAt) {
      const durationSeconds = (tx.attestationReceivedAt.getTime() - tx.createdAt.getTime()) / 1000;
      bridgeAttestationDuration.observe({ type: 'withdrawal' }, durationSeconds);
    }
  }

  /**
   * Mark transaction as failed.
   */
  async markFailed(bridgeId: string, reason: string): Promise<void> {
    logger.error({ bridgeId, reason }, 'Bridge transaction failed');

    // Get transaction type for metrics
    const tx = await this.getById(bridgeId);

    await this.db.update(schema.bridgeTransactions)
      .set({
        status: 'failed',
        failureReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(schema.bridgeTransactions.id, bridgeId));

    // Record metrics
    if (tx) {
      bridgeTransactionsTotal.inc({ type: tx.type, status: 'failed' });
    }
  }

  /**
   * Get bridge transaction by ID.
   */
  async getById(bridgeId: string): Promise<schema.BridgeTransaction | null> {
    const [tx] = await this.db.select()
      .from(schema.bridgeTransactions)
      .where(eq(schema.bridgeTransactions.id, bridgeId))
      .limit(1);

    return tx ?? null;
  }

  /**
   * Get bridge transaction by Ethereum tx hash.
   */
  async getByEthTxHash(ethTxHash: string): Promise<schema.BridgeTransaction | null> {
    const [tx] = await this.db.select()
      .from(schema.bridgeTransactions)
      .where(eq(schema.bridgeTransactions.ethTxHash, ethTxHash))
      .limit(1);

    return tx ?? null;
  }

  /**
   * Get bridge history for a user.
   */
  async getHistory(params: BridgeHistoryParams): Promise<{
    transactions: schema.BridgeTransaction[];
    total: number;
  }> {
    const { userId, type, status, limit = 20, offset = 0 } = params;

    // Build where conditions
    const conditions = [eq(schema.bridgeTransactions.userId, userId)];

    if (type) {
      conditions.push(eq(schema.bridgeTransactions.type, type));
    }

    if (status) {
      conditions.push(eq(schema.bridgeTransactions.status, status));
    }

    // Get transactions
    const transactions = await this.db.select()
      .from(schema.bridgeTransactions)
      .where(and(...conditions))
      .orderBy(desc(schema.bridgeTransactions.createdAt))
      .limit(limit)
      .offset(offset);

    // Count manually since count() aggregation is complex in drizzle
    const allTxs = await this.db.select({ id: schema.bridgeTransactions.id })
      .from(schema.bridgeTransactions)
      .where(and(...conditions));

    return {
      transactions,
      total: allTxs.length,
    };
  }

  /**
   * Get all transactions pending attestation.
   * Used by the background polling job.
   */
  async getPendingAttestations(): Promise<schema.BridgeTransaction[]> {
    return this.db.select()
      .from(schema.bridgeTransactions)
      .where(
        and(
          eq(schema.bridgeTransactions.attestationStatus, 'pending'),
          or(
            eq(schema.bridgeTransactions.status, 'attestation_pending'),
            eq(schema.bridgeTransactions.status, 'eth_tx_confirmed'),
            eq(schema.bridgeTransactions.status, 'burn_completed')
          )
        )
      );
  }

  /**
   * Get deposit attestations ready for minting.
   * These have attestations received but USDCx not yet minted.
   */
  async getAttestationsReadyForMint(): Promise<schema.BridgeTransaction[]> {
    return this.db.select()
      .from(schema.bridgeTransactions)
      .where(
        and(
          eq(schema.bridgeTransactions.type, 'deposit'),
          eq(schema.bridgeTransactions.status, 'attestation_received'),
          isNotNull(schema.bridgeTransactions.attestationHash)
        )
      );
  }

  /**
   * Increment retry count and set next retry time.
   */
  async incrementRetry(bridgeId: string, nextRetryMinutes = 5): Promise<void> {
    const nextRetryAt = new Date(Date.now() + nextRetryMinutes * 60 * 1000);

    await this.db.update(schema.bridgeTransactions)
      .set({
        retryCount: schema.bridgeTransactions.retryCount,
        lastRetryAt: new Date(),
        nextRetryAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.bridgeTransactions.id, bridgeId));

    // Manual increment since drizzle doesn't support increment easily
    const [tx] = await this.db.select({ retryCount: schema.bridgeTransactions.retryCount })
      .from(schema.bridgeTransactions)
      .where(eq(schema.bridgeTransactions.id, bridgeId));

    if (tx) {
      await this.db.update(schema.bridgeTransactions)
        .set({ retryCount: tx.retryCount + 1 })
        .where(eq(schema.bridgeTransactions.id, bridgeId));
    }
  }

  /**
   * Get statistics for bridge service.
   */
  async getStats(): Promise<{
    totalDeposits: number;
    totalWithdrawals: number;
    pendingDeposits: number;
    pendingWithdrawals: number;
    failedTransactions: number;
  }> {
    const allTxs = await this.db.select({
      type: schema.bridgeTransactions.type,
      status: schema.bridgeTransactions.status,
    }).from(schema.bridgeTransactions);

    const stats = {
      totalDeposits: 0,
      totalWithdrawals: 0,
      pendingDeposits: 0,
      pendingWithdrawals: 0,
      failedTransactions: 0,
    };

    for (const tx of allTxs) {
      if (tx.type === 'deposit') {
        stats.totalDeposits++;
        if (tx.status !== 'completed' && tx.status !== 'failed') {
          stats.pendingDeposits++;
        }
      } else {
        stats.totalWithdrawals++;
        if (tx.status !== 'completed' && tx.status !== 'failed') {
          stats.pendingWithdrawals++;
        }
      }

      if (tx.status === 'failed') {
        stats.failedTransactions++;
      }
    }

    return stats;
  }
}

// Singleton instance (will be initialized in app startup)
let bridgeServiceInstance: BridgeService | null = null;

export function getBridgeService(): BridgeService {
  if (!bridgeServiceInstance) {
    throw new Error('BridgeService not initialized. Call initBridgeService first.');
  }
  return bridgeServiceInstance;
}

export function initBridgeService(
  db: PostgresJsDatabase<typeof schema>,
  sdk?: OfficialSDKClient,
  isTestnet?: boolean
): BridgeService {
  bridgeServiceInstance = new BridgeService(db, sdk, isTestnet);
  return bridgeServiceInstance;
}

export default BridgeService;
