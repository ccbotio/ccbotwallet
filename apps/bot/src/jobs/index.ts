import { Queue, Worker } from 'bullmq';
import { eq, and, lt } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { JOB_QUEUES, UTXO_MERGE_CONFIG, CANTON_SYNC_CONFIG, SWAP_REFUND_CONFIG, BRIDGE_POLLING_CONFIG, TREASURY_MONITOR_CONFIG } from '../config/constants.js';
import { env } from '../config/env.js';
import { db, wallets, users, transactions, swapTransactions } from '../db/index.js';
import { getCantonAgent } from '../services/canton/index.js';
import { notificationService, type NotificationJobData } from '../services/notification/index.js';
import { getRedisClient } from '../lib/redis.js';
import { emailService } from '../services/email/index.js';
import { alertRefundFailed, alertRefundSuccess, alertBridgeFailed, checkTreasuryBalances } from '../services/admin/alerts.js';

const connection = { host: 'localhost', port: 6379 };

// Parse Redis URL if available
if (env.REDIS_URL) {
  try {
    const url = new URL(env.REDIS_URL);
    Object.assign(connection, {
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
    });
  } catch {
    // Use defaults
  }
}

export const notificationQueue = new Queue(JOB_QUEUES.notifications, { connection });
export const utxoMergeQueue = new Queue(JOB_QUEUES.utxoMerge, { connection });
export const cantonSyncQueue = new Queue(JOB_QUEUES.cantonSync, { connection });
export const swapRefundQueue = new Queue(JOB_QUEUES.swapRefund, { connection });
export const bridgePollingQueue = new Queue(JOB_QUEUES.bridgePolling, { connection });
export const treasuryMonitorQueue = new Queue(JOB_QUEUES.treasuryMonitor, { connection });

export function initWorkers() {
  // Notification Worker - Sends Telegram and email notifications
  new Worker<NotificationJobData>(
    JOB_QUEUES.notifications,
    async (job) => {
      const data = job.data;
      logger.info({ jobId: job.id, type: data.type }, 'Processing notification job');
      try {
        await notificationService.processJob(data);
        logger.info({ jobId: job.id, type: data.type }, 'Notification job completed');
      } catch (error) {
        logger.error({ err: error, jobId: job.id }, 'Notification job failed');
        throw error;
      }
    },
    { connection }
  );

  // UTXO Merge Worker
  // Checks UTXO counts and notifies users when merge is needed.
  // Actual merge requires user's PIN (Shamir 2-of-3 security).
  new Worker(
    JOB_QUEUES.utxoMerge,
    async (job) => {
      logger.info({ jobId: job.id }, 'Processing UTXO merge job (checking UTXO counts)');

      try {
        const agent = getCantonAgent();
        const redis = getRedisClient();
        const allWallets = await db.select().from(wallets);

        let walletsNeedingMerge = 0;
        let notificationsSent = 0;

        for (const wallet of allWallets) {
          try {
            const holdings = await agent.listHoldings(wallet.partyId);
            const utxoCount = holdings.length;

            if (utxoCount > UTXO_MERGE_CONFIG.maxUtxos) {
              walletsNeedingMerge++;

              // Check if we already notified this user recently (24h cooldown)
              const notifyKey = `utxo_notify:${wallet.id}`;
              const alreadyNotified = await redis.get(notifyKey);

              if (!alreadyNotified) {
                // Get user's telegram ID
                const [user] = await db
                  .select()
                  .from(users)
                  .where(eq(users.id, wallet.userId))
                  .limit(1);

                if (user) {
                  const sent = await notificationService.notifyUtxoMergeNeeded(
                    user.telegramId,
                    utxoCount,
                    UTXO_MERGE_CONFIG.maxUtxos
                  );

                  if (sent) {
                    // Set 24h cooldown
                    await redis.set(notifyKey, '1', 'EX', 86400);
                    notificationsSent++;
                  }
                }
              }

              logger.warn(
                {
                  walletId: wallet.id,
                  partyId: wallet.partyId,
                  utxoCount,
                  threshold: UTXO_MERGE_CONFIG.maxUtxos,
                },
                'Wallet has too many UTXOs'
              );
            }
          } catch (error) {
            logger.error({ err: error, walletId: wallet.id }, 'Failed to check UTXOs for wallet');
          }
        }

        logger.info(
          { walletsNeedingMerge, notificationsSent, walletsChecked: allWallets.length },
          'UTXO check job completed'
        );
      } catch (error) {
        logger.error({ err: error }, 'UTXO check job failed');
        throw error;
      }
    },
    { connection }
  );

  // Canton Sync Worker - Syncs transactions from Canton ledger
  // Detects incoming transfers and sends notifications
  // Uses idempotent upserts (ON CONFLICT) to prevent duplicates
  new Worker(
    JOB_QUEUES.cantonSync,
    async (job) => {
      logger.info({ jobId: job.id }, 'Processing Canton sync job');

      try {
        const agent = getCantonAgent();
        const redis = getRedisClient();
        const allWallets = await db.select().from(wallets);

        let syncedTransactions = 0;
        let updatedTransactions = 0;
        let notificationsSent = 0;

        for (const wallet of allWallets) {
          try {
            // Get last sync offset from Redis
            const offsetKey = `canton_sync:${wallet.id}:offset`;
            const lastOffset = await redis.get(offsetKey);

            // Fetch transaction history from Canton (with retry via agent)
            const cantonTxs = await agent.getTransactionHistory(
              wallet.partyId,
              50,
              lastOffset || undefined
            );

            if (cantonTxs.length === 0) {
              continue;
            }

            // Get user for notifications
            const [user] = await db
              .select({ telegramId: users.telegramId, email: users.email })
              .from(users)
              .where(eq(users.id, wallet.userId))
              .limit(1);

            // Process transactions with idempotent upsert
            for (const cantonTx of cantonTxs) {
              // Determine transaction type (both incoming and outgoing)
              const isReceive = cantonTx.type === 'receive';
              const fromParty = isReceive ? cantonTx.counterparty : wallet.partyId;
              const toParty = isReceive ? wallet.partyId : cantonTx.counterparty;

              // Use ON CONFLICT DO UPDATE for idempotent upsert
              // This handles both new transactions and status updates atomically
              const result = await db
                .insert(transactions)
                .values({
                  walletId: wallet.id,
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
                // Check if this was a new insert (createdAt within last second)
                const isNew = tx && tx.createdAt.getTime() >= Date.now() - 1000;

                if (isNew) {
                  syncedTransactions++;

                  // Send notification for incoming transfers (new transactions only)
                  if (isReceive && user) {
                    try {
                      await queueNotification({
                        type: 'incoming_transfer',
                        telegramId: user.telegramId,
                        ...(user.email && { email: user.email }),
                        data: {
                          amount: cantonTx.amount,
                          fromParty: cantonTx.counterparty,
                        },
                      });
                      notificationsSent++;
                    } catch (notifyError) {
                      logger.error(
                        { err: notifyError, txHash: cantonTx.txHash },
                        'Failed to queue incoming transfer notification'
                      );
                    }
                  }
                } else if (tx) {
                  // Existing transaction that was updated (pending -> confirmed)
                  updatedTransactions++;
                }
              }
            }

            // Update last sync offset
            if (cantonTxs.length > 0) {
              const lastTx = cantonTxs[cantonTxs.length - 1];
              if (lastTx) {
                await redis.set(offsetKey, lastTx.updateId);
              }
            }

            // Mark stale pending transactions as failed (older than 5 minutes)
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            const failedTxs = await db
              .update(transactions)
              .set({ status: 'failed' })
              .where(
                and(
                  eq(transactions.walletId, wallet.id),
                  eq(transactions.status, 'pending'),
                  lt(transactions.createdAt, fiveMinutesAgo)
                )
              )
              .returning({ id: transactions.id });

            if (failedTxs.length > 0) {
              updatedTransactions += failedTxs.length;
              logger.warn(
                { walletId: wallet.id, count: failedTxs.length },
                'Marked stale pending transactions as failed'
              );
            }

            logger.debug(
              { walletId: wallet.id, synced: syncedTransactions, updated: updatedTransactions },
              'Wallet transactions synced'
            );
          } catch (error) {
            logger.error({ err: error, walletId: wallet.id }, 'Failed to sync wallet transactions');
          }
        }

        // Cleanup expired email codes (runs with each sync)
        try {
          await emailService.cleanupExpiredCodes();
        } catch (cleanupError) {
          logger.error({ err: cleanupError }, 'Failed to cleanup expired email codes');
        }

        logger.info(
          {
            walletsProcessed: allWallets.length,
            syncedTransactions,
            updatedTransactions,
            notificationsSent,
          },
          'Canton sync job completed'
        );
      } catch (error) {
        logger.error({ err: error }, 'Canton sync job failed');
        throw error;
      }
    },
    { connection }
  );

  // Swap Refund Worker - Retries failed refunds for swaps
  // This is a safety net for when automatic refunds fail during swap execution
  // NOTE: Requires TREASURY_PARTY_ID and TREASURY_PRIVATE_KEY env vars to be set
  new Worker(
    JOB_QUEUES.swapRefund,
    async (job) => {
      logger.info({ jobId: job.id }, 'Processing swap refund retry job');

      // Check if treasury is configured
      const treasuryPartyId = process.env.TREASURY_PARTY_ID;
      const treasuryPrivateKey = process.env.TREASURY_PRIVATE_KEY;

      if (!treasuryPartyId || !treasuryPrivateKey) {
        logger.debug('Treasury not configured (TREASURY_PARTY_ID/TREASURY_PRIVATE_KEY), skipping refund job');
        return;
      }

      try {
        // Find swaps with refund_pending status that haven't exceeded max retries
        const pendingRefunds = await db
          .select()
          .from(swapTransactions)
          .where(
            and(
              eq(swapTransactions.status, 'refund_pending'),
              lt(swapTransactions.refundAttempts, SWAP_REFUND_CONFIG.maxRetries)
            )
          );

        if (pendingRefunds.length === 0) {
          logger.debug('No pending refunds to process');
          return;
        }

        logger.info({ count: pendingRefunds.length }, 'Found pending refunds to process');

        const agent = getCantonAgent();
        let refundedCount = 0;
        let failedCount = 0;
        let skippedCount = 0;

        for (const swap of pendingRefunds) {
          // Skip if swap is too old (past max age)
          const maxAge = SWAP_REFUND_CONFIG.maxAgeMinutes * 60 * 1000;
          if (Date.now() - swap.createdAt.getTime() > maxAge) {
            logger.warn(
              { swapId: swap.id, ageMinutes: Math.round((Date.now() - swap.createdAt.getTime()) / 60000) },
              'Swap refund exceeded max age, marking as refund_failed'
            );

            await db
              .update(swapTransactions)
              .set({
                status: 'refund_failed',
                failureReason: `${swap.failureReason || ''} Refund exceeded max age of ${SWAP_REFUND_CONFIG.maxAgeMinutes} minutes.`,
              })
              .where(eq(swapTransactions.id, swap.id));

            failedCount++;
            continue;
          }

          // Skip if no user party ID (shouldn't happen)
          if (!swap.userPartyId || !swap.refundAmount) {
            logger.error({ swapId: swap.id }, 'Missing userPartyId or refundAmount for refund');
            skippedCount++;
            continue;
          }

          try {
            logger.info(
              { swapId: swap.id, attempt: swap.refundAttempts + 1, userPartyId: swap.userPartyId },
              'Attempting refund via background job'
            );

            // Use the agent's SDK to send the refund
            // Note: sendTransfer only supports CC currently. For USDCx refunds,
            // we need to use the SDK directly via agent.getSDK().sendToken()
            const sdk = agent.getSDK();
            const result = await sdk.sendToken(
              {
                fromParty: treasuryPartyId,
                toParty: swap.userPartyId,
                token: swap.fromToken as 'CC' | 'USDCx',
                amount: swap.refundAmount,
                memo: `Refund for failed swap ${swap.id}`,
              },
              treasuryPrivateKey,
              swap.fromToken as 'CC' | 'USDCx'
            );

            // Update swap as refunded
            await db
              .update(swapTransactions)
              .set({
                status: 'refunded',
                refundTxHash: result.txHash,
                refundedAt: new Date(),
                refundAttempts: swap.refundAttempts + 1,
              })
              .where(eq(swapTransactions.id, swap.id));

            refundedCount++;
            logger.info({ swapId: swap.id, txHash: result.txHash }, 'Refund successful');

            // Send success alert
            alertRefundSuccess({
              swapId: swap.id,
              refundAmount: swap.refundAmount || swap.fromAmount,
              refundToken: swap.fromToken,
              txHash: result.txHash,
            }).catch(err => logger.warn({ err }, 'Failed to send refund success alert'));
          } catch (refundError) {
            const errorMsg = refundError instanceof Error ? refundError.message : 'Unknown error';

            // Update refund attempts
            await db
              .update(swapTransactions)
              .set({
                refundAttempts: swap.refundAttempts + 1,
                failureReason: `${swap.failureReason || ''} Refund attempt ${swap.refundAttempts + 1} failed: ${errorMsg}`,
              })
              .where(eq(swapTransactions.id, swap.id));

            // Check if max retries exceeded
            if (swap.refundAttempts + 1 >= SWAP_REFUND_CONFIG.maxRetries) {
              await db
                .update(swapTransactions)
                .set({ status: 'refund_failed' })
                .where(eq(swapTransactions.id, swap.id));

              logger.error(
                { swapId: swap.id, err: refundError },
                'Refund permanently failed after max retries - MANUAL INTERVENTION REQUIRED'
              );

              // CRITICAL ALERT: Refund failed permanently
              alertRefundFailed({
                swapId: swap.id,
                userId: swap.userId,
                userPartyId: swap.userPartyId || 'unknown',
                refundAmount: swap.refundAmount || swap.fromAmount,
                refundToken: swap.fromToken,
                attempts: swap.refundAttempts + 1,
                error: errorMsg,
              }).catch(err => logger.warn({ err }, 'Failed to send refund failed alert'));
            } else {
              logger.warn(
                { swapId: swap.id, attempt: swap.refundAttempts + 1, err: refundError },
                'Refund attempt failed, will retry on next job run'
              );
            }

            failedCount++;
          }
        }

        logger.info(
          { pendingCount: pendingRefunds.length, refundedCount, failedCount, skippedCount },
          'Swap refund job completed'
        );
      } catch (error) {
        logger.error({ err: error }, 'Swap refund job failed');
        throw error;
      }
    },
    { connection }
  );

  // Bridge Polling Worker - Polls Circle API for attestations
  // and processes pending bridge transactions
  new Worker(
    JOB_QUEUES.bridgePolling,
    async (job) => {
      logger.info({ jobId: job.id }, 'Processing bridge polling job');

      try {
        // Import bridge service dynamically to avoid circular deps
        const { getBridgeService } = await import('../services/bridge/index.js');

        let bridgeService: ReturnType<typeof getBridgeService> | null = null;
        try {
          bridgeService = getBridgeService();
        } catch {
          logger.debug('BridgeService not initialized yet, skipping polling');
          return;
        }

        // Get transactions pending attestation
        const pendingTxs = await bridgeService.getPendingAttestations();

        if (pendingTxs.length === 0) {
          logger.debug('No pending bridge attestations to poll');
          return;
        }

        logger.info({ count: pendingTxs.length }, 'Polling attestations for pending bridge transactions');

        let processedCount = 0;
        let attestationsReceived = 0;
        let failedCount = 0;

        for (const tx of pendingTxs) {
          // Check if max retries exceeded
          if (tx.retryCount >= BRIDGE_POLLING_CONFIG.maxRetries) {
            logger.warn({ bridgeId: tx.id }, 'Bridge tx exceeded max retries, marking as failed');
            await bridgeService.markFailed(tx.id, 'Attestation polling timed out');
            failedCount++;

            // Alert: Bridge transaction failed
            alertBridgeFailed({
              bridgeId: tx.id,
              userId: tx.userId,
              type: tx.type as 'deposit' | 'withdrawal',
              amount: tx.fromAmount,
              error: 'Attestation polling timed out after max retries',
            }).catch(err => logger.warn({ err }, 'Failed to send bridge failed alert'));
            continue;
          }

          // Check if max age exceeded
          const maxAgeMs = BRIDGE_POLLING_CONFIG.maxAgeHours * 60 * 60 * 1000;
          if (Date.now() - tx.createdAt.getTime() > maxAgeMs) {
            logger.warn({ bridgeId: tx.id }, 'Bridge tx exceeded max age, marking as failed');
            await bridgeService.markFailed(tx.id, 'Transaction expired');
            failedCount++;

            // Alert: Bridge transaction expired
            alertBridgeFailed({
              bridgeId: tx.id,
              userId: tx.userId,
              type: tx.type as 'deposit' | 'withdrawal',
              amount: tx.fromAmount,
              error: 'Transaction expired after 24 hours',
            }).catch(err => logger.warn({ err }, 'Failed to send bridge failed alert'));
            continue;
          }

          try {
            // Determine which hash to poll
            const hashToPoll = tx.type === 'deposit' ? tx.ethTxHash : tx.cantonTxHash;

            if (!hashToPoll) {
              logger.warn({ bridgeId: tx.id }, 'No hash available for attestation polling');
              continue;
            }

            // Poll Circle API
            const result = await bridgeService.pollAttestation(hashToPoll, tx.type as 'deposit' | 'withdrawal');

            if (result.status === 'complete' && result.attestation) {
              // Attestation received!
              await bridgeService.receiveAttestation(tx.id, result.attestation);
              attestationsReceived++;
              logger.info({ bridgeId: tx.id, type: tx.type }, 'Attestation received for bridge tx');
            } else {
              // Still pending, increment retry count
              await bridgeService.incrementRetry(tx.id);
            }

            processedCount++;
          } catch (pollError) {
            logger.error({ bridgeId: tx.id, err: pollError }, 'Error polling attestation');
            await bridgeService.incrementRetry(tx.id);
          }
        }

        // Process attestations ready for minting (deposits)
        const readyForMint = await bridgeService.getAttestationsReadyForMint();

        if (readyForMint.length > 0) {
          logger.info({ count: readyForMint.length }, 'Processing attestations ready for mint');

          for (const tx of readyForMint) {
            try {
              // TODO: Call SDK to mint USDCx from attestation
              // This requires the user's private key, so may need to be
              // triggered by the user through the API instead
              logger.info({ bridgeId: tx.id }, 'Attestation ready for mint (requires user action)');
            } catch (mintError) {
              logger.error({ bridgeId: tx.id, err: mintError }, 'Error processing mint');
            }
          }
        }

        logger.info(
          { pendingCount: pendingTxs.length, processedCount, attestationsReceived, failedCount },
          'Bridge polling job completed'
        );
      } catch (error) {
        logger.error({ err: error }, 'Bridge polling job failed');
        throw error;
      }
    },
    { connection }
  );

  // Treasury Monitor Worker - Checks treasury balances periodically
  // and alerts admins when balances are low
  new Worker(
    JOB_QUEUES.treasuryMonitor,
    async (job) => {
      logger.info({ jobId: job.id }, 'Processing treasury monitor job');

      // Check if treasury is configured
      const treasuryPartyId = process.env.TREASURY_PARTY_ID;
      if (!treasuryPartyId) {
        logger.debug('Treasury not configured, skipping monitor');
        return;
      }

      try {
        const agent = getCantonAgent();
        const sdk = agent.getSDK();

        // Get treasury balances
        const balances = await sdk.getAllBalances(treasuryPartyId);

        const ccBalance = balances.cc?.amount || '0';
        const usdcxBalance = balances.usdcx?.amount || '0';

        logger.info(
          { treasuryPartyId, ccBalance, usdcxBalance },
          'Treasury balance check'
        );

        // Check balances and alert if low
        await checkTreasuryBalances({
          cc: ccBalance,
          usdcx: usdcxBalance,
        });

      } catch (error) {
        logger.error({ err: error }, 'Treasury monitor job failed');
        // Don't throw - we don't want to fail the job for temporary errors
      }
    },
    { connection }
  );

  logger.info('Workers initialized');
}

/**
 * Queue a notification job.
 * The notification will be processed asynchronously by the worker.
 */
export async function queueNotification(data: NotificationJobData): Promise<void> {
  await notificationQueue.add(data.type, data, {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  });
  logger.debug({ type: data.type, telegramId: data.telegramId }, 'Notification queued');
}

/**
 * Schedule the UTXO merge job to run periodically.
 * Should be called once on server startup.
 */
export async function scheduleUtxoMergeJob() {
  // Remove any existing repeatable jobs
  const existingJobs = await utxoMergeQueue.getRepeatableJobs();
  for (const job of existingJobs) {
    await utxoMergeQueue.removeRepeatableByKey(job.key);
  }

  // Add new repeatable job
  await utxoMergeQueue.add(
    'auto-merge',
    {},
    {
      repeat: {
        every: UTXO_MERGE_CONFIG.checkIntervalMs,
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );

  logger.info({ intervalMs: UTXO_MERGE_CONFIG.checkIntervalMs }, 'UTXO merge job scheduled');
}

/**
 * Schedule the Canton sync job to run periodically.
 * Syncs transaction history from Canton ledger to local database.
 */
export async function scheduleCantonSyncJob() {
  // Remove any existing repeatable jobs
  const existingJobs = await cantonSyncQueue.getRepeatableJobs();
  for (const job of existingJobs) {
    await cantonSyncQueue.removeRepeatableByKey(job.key);
  }

  // Add new repeatable job
  await cantonSyncQueue.add(
    'auto-sync',
    {},
    {
      repeat: {
        every: CANTON_SYNC_CONFIG.checkIntervalMs,
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );

  logger.info({ intervalMs: CANTON_SYNC_CONFIG.checkIntervalMs }, 'Canton sync job scheduled');
}

/**
 * Schedule the swap refund job to run periodically.
 * Retries failed refunds for swap transactions that failed after user sent funds.
 */
export async function scheduleSwapRefundJob() {
  // Remove any existing repeatable jobs
  const existingJobs = await swapRefundQueue.getRepeatableJobs();
  for (const job of existingJobs) {
    await swapRefundQueue.removeRepeatableByKey(job.key);
  }

  // Add new repeatable job
  await swapRefundQueue.add(
    'auto-refund',
    {},
    {
      repeat: {
        every: SWAP_REFUND_CONFIG.checkIntervalMs,
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );

  logger.info({ intervalMs: SWAP_REFUND_CONFIG.checkIntervalMs }, 'Swap refund job scheduled');
}

/**
 * Schedule the bridge polling job to run periodically.
 * Polls Circle xReserve API for attestation status.
 */
export async function scheduleBridgePollingJob() {
  // Remove any existing repeatable jobs
  const existingJobs = await bridgePollingQueue.getRepeatableJobs();
  for (const job of existingJobs) {
    await bridgePollingQueue.removeRepeatableByKey(job.key);
  }

  // Add new repeatable job
  await bridgePollingQueue.add(
    'auto-poll',
    {},
    {
      repeat: {
        every: BRIDGE_POLLING_CONFIG.checkIntervalMs,
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );

  logger.info({ intervalMs: BRIDGE_POLLING_CONFIG.checkIntervalMs }, 'Bridge polling job scheduled');
}

/**
 * Schedule the treasury monitor job to run periodically.
 * Checks treasury balances and sends alerts when low.
 */
export async function scheduleTreasuryMonitorJob() {
  // Remove any existing repeatable jobs
  const existingJobs = await treasuryMonitorQueue.getRepeatableJobs();
  for (const job of existingJobs) {
    await treasuryMonitorQueue.removeRepeatableByKey(job.key);
  }

  // Add new repeatable job
  await treasuryMonitorQueue.add(
    'auto-monitor',
    {},
    {
      repeat: {
        every: TREASURY_MONITOR_CONFIG.checkIntervalMs,
      },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );

  logger.info({ intervalMs: TREASURY_MONITOR_CONFIG.checkIntervalMs }, 'Treasury monitor job scheduled');
}
