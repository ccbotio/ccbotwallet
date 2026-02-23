import { Queue, Worker } from 'bullmq';
import { eq, and, lt } from 'drizzle-orm';
import { logger } from '../lib/logger.js';
import { JOB_QUEUES, UTXO_MERGE_CONFIG, CANTON_SYNC_CONFIG } from '../config/constants.js';
import { env } from '../config/env.js';
import { db, wallets, users, transactions } from '../db/index.js';
import { getCantonAgent } from '../services/canton/index.js';
import { notificationService, type NotificationJobData } from '../services/notification/index.js';
import { getRedisClient } from '../lib/redis.js';
import { emailService } from '../services/email/index.js';

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
