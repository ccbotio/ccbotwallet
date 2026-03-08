import { eq, and, lt } from 'drizzle-orm';
import { db, transactions, wallets, users, notifications } from '../../db/index.js';
import type { OfficialSDKClient } from '@repo/canton-client';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import { notifyIncomingTransfer } from '../notification/index.js';
import { WalletService } from '../wallet/index.js';

const SYNC_CURSOR_PREFIX = 'canton:sync:cursor:';

/**
 * Transaction Sync Service
 *
 * Syncs transactions from Canton ledger to local database.
 */
export class TransactionSyncService {
  constructor(private sdk: OfficialSDKClient) {}

  /**
   * Get the last sync cursor for a wallet.
   */
  private async getLastSyncCursor(walletId: string): Promise<string | null> {
    const cursor = await redis.get(`${SYNC_CURSOR_PREFIX}${walletId}`);
    return cursor;
  }

  /**
   * Save the last sync cursor for a wallet.
   */
  private async setLastSyncCursor(walletId: string, cursor: string): Promise<void> {
    await redis.set(`${SYNC_CURSOR_PREFIX}${walletId}`, cursor, 'EX', 86400 * 7); // 7 days
  }

  /**
   * Sync transactions from Canton ledger to local database.
   */
  async syncWallet(walletId: string): Promise<{
    synced: number;
    updated: number;
    accepted: number;
  }> {
    const [wallet] = await db.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    return this.syncByPartyId(wallet.partyId, walletId);
  }

  /**
   * Sync transactions for a specific party from Canton ledger.
   * Uses idempotent upserts (ON CONFLICT) to prevent duplicates and
   * properly track transaction status (pending -> confirmed/failed).
   * Also auto-accepts any pending incoming transfers (Token Standard 2-step).
   */
  async syncByPartyId(
    partyId: string,
    walletId: string
  ): Promise<{
    synced: number;
    updated: number;
    accepted: number;
  }> {
    let synced = 0;
    let updated = 0;
    let accepted = 0;

    try {
      // Auto-accept pending incoming transfers first
      accepted = await this.acceptPendingTransfersForWallet(walletId, partyId);

      // Get last sync cursor
      const lastCursor = await this.getLastSyncCursor(walletId);

      // Fetch transaction history from Canton ledger
      const cantonTxs = await this.sdk.getTransactionHistory(
        partyId,
        100, // Fetch up to 100 transactions
        lastCursor ?? undefined
      );

      logger.debug(
        { partyId, txCount: cantonTxs.length, lastCursor },
        'Fetched transactions from Canton'
      );

      // Process each transaction with idempotent upsert
      for (const cantonTx of cantonTxs) {
        // Determine transaction type (both incoming and outgoing)
        const isReceive = cantonTx.type === 'receive';
        const fromParty = isReceive ? cantonTx.counterparty : partyId;
        const toParty = isReceive ? partyId : cantonTx.counterparty;

        // Use ON CONFLICT DO UPDATE for idempotent upsert
        // This handles both new transactions and status updates atomically
        const result = await db
          .insert(transactions)
          .values({
            walletId,
            type: cantonTx.type,
            status: 'confirmed',
            amount: cantonTx.amount,
            token: 'CC',
            fromParty,
            toParty,
            txHash: cantonTx.txHash,
            confirmedAt: new Date(cantonTx.timestamp),
          })
          .onConflictDoUpdate({
            target: transactions.txHash,
            set: {
              // Update status to confirmed (from pending)
              status: 'confirmed',
              confirmedAt: new Date(cantonTx.timestamp),
            },
            // Only update if status was pending (not already confirmed/failed)
            setWhere: eq(transactions.status, 'pending'),
          })
          .returning();

        if (result.length > 0) {
          const tx = result[0];
          // Check if this was a new insert or an update
          // If confirmedAt was just set (within 1 second), it's either new or updated
          if (tx && tx.createdAt.getTime() >= Date.now() - 1000) {
            synced++;

            // Generate notification for incoming transfers (new transactions only)
            if (isReceive) {
              await this.createTransferNotification(
                walletId,
                tx.id,
                cantonTx.amount,
                cantonTx.counterparty
              );
            }
          } else if (tx) {
            // Existing transaction that was updated
            updated++;
          }
        }
      }

      // Update sync cursor
      if (cantonTxs.length > 0) {
        const lastTx = cantonTxs[cantonTxs.length - 1];
        if (lastTx) {
          await this.setLastSyncCursor(walletId, lastTx.updateId);
        }
      }

      // Mark stale pending transactions as failed
      updated += await this.markStalePendingTransactions(walletId);

      logger.info({ partyId, synced, updated, accepted }, 'Transaction sync completed for wallet');

      return { synced, updated, accepted };
    } catch (error) {
      logger.error({ err: error, partyId }, 'Failed to sync transactions from Canton');
      return { synced, updated, accepted };
    }
  }

  /**
   * Accept pending incoming transfers for a wallet.
   * This converts TransferInstruction contracts into Holding contracts.
   */
  private async acceptPendingTransfersForWallet(
    walletId: string,
    partyId: string
  ): Promise<number> {
    try {
      // Get wallet and user to find telegramId (needed for key derivation)
      const [wallet] = await db.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
      if (!wallet) return 0;

      const [user] = await db.select().from(users).where(eq(users.id, wallet.userId)).limit(1);
      if (!user) return 0;

      // Check if user has auto-accept transfers enabled
      if (!user.autoAcceptTransfers) {
        return 0;
      }

      // Use WalletService to accept pending transfers
      const walletService = new WalletService(this.sdk);
      const result = await walletService.acceptPendingTransfers(user.telegramId, partyId);

      if (result.accepted > 0) {
        logger.info(
          { walletId, partyId, accepted: result.accepted },
          'Auto-accepted pending transfers during sync'
        );
      }

      return result.accepted;
    } catch (error) {
      logger.error({ err: error, walletId }, 'Failed to auto-accept pending transfers');
      return 0;
    }
  }

  /**
   * Create a notification for an incoming transfer.
   */
  private async createTransferNotification(
    walletId: string,
    txId: string,
    amount: string,
    fromParty: string
  ): Promise<void> {
    try {
      // Get wallet and user info
      const [wallet] = await db.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);

      if (!wallet) return;

      const [user] = await db.select().from(users).where(eq(users.id, wallet.userId)).limit(1);

      if (!user) return;

      // Format amount for display
      const formattedAmount = parseFloat(amount).toFixed(2);
      const shortFrom =
        fromParty.length > 20 ? `${fromParty.slice(0, 10)}...${fromParty.slice(-8)}` : fromParty;

      // Create in-app notification
      await db.insert(notifications).values({
        userId: user.id,
        type: 'transfer_received',
        title: 'Transfer Received',
        body: `You received ${formattedAmount} CC from ${shortFrom}`,
        data: {
          txId,
          amount,
          from: fromParty,
        },
        read: false,
      });

      // Also send Telegram notification
      await notifyIncomingTransfer(user.telegramId, formattedAmount, fromParty);

      logger.info(
        { userId: user.id, amount, fromParty },
        'Created notification for incoming transfer'
      );
    } catch (error) {
      logger.error({ err: error, walletId, txId }, 'Failed to create transfer notification');
    }
  }

  /**
   * Mark pending transactions older than 5 minutes as failed.
   * Uses a single atomic update query for efficiency.
   */
  private async markStalePendingTransactions(walletId: string): Promise<number> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Atomic update of all stale pending transactions
    const result = await db
      .update(transactions)
      .set({ status: 'failed' })
      .where(
        and(
          eq(transactions.walletId, walletId),
          eq(transactions.status, 'pending'),
          lt(transactions.createdAt, fiveMinutesAgo)
        )
      )
      .returning({ id: transactions.id });

    if (result.length > 0) {
      logger.warn(
        { walletId, count: result.length, txIds: result.map((r) => r.id) },
        'Marked stale pending transactions as failed'
      );
    }

    return result.length;
  }

  /**
   * Sync all wallets in the database.
   */
  async syncAllWallets(): Promise<{
    walletsProcessed: number;
    totalSynced: number;
    totalUpdated: number;
    totalAccepted: number;
  }> {
    const allWallets = await db.select().from(wallets);

    let totalSynced = 0;
    let totalUpdated = 0;
    let totalAccepted = 0;

    for (const wallet of allWallets) {
      try {
        const result = await this.syncByPartyId(wallet.partyId, wallet.id);
        totalSynced += result.synced;
        totalUpdated += result.updated;
        totalAccepted += result.accepted;
      } catch (error) {
        logger.error({ err: error, walletId: wallet.id }, 'Failed to sync wallet');
      }
    }

    logger.info(
      {
        walletsProcessed: allWallets.length,
        totalSynced,
        totalUpdated,
        totalAccepted,
      },
      'Transaction sync completed for all wallets'
    );

    return {
      walletsProcessed: allWallets.length,
      totalSynced,
      totalUpdated,
      totalAccepted,
    };
  }
}
