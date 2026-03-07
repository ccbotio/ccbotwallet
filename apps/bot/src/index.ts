import { bot, initBot } from './bot/index.js';
import { initServer } from './api/server.js';
import {
  initWorkers,
  scheduleUtxoMergeJob,
  scheduleCantonSyncJob,
  scheduleSwapRefundJob,
  scheduleBridgePollingJob,
  scheduleTreasuryMonitorJob,
} from './jobs/index.js';
import { initCantonAgent, shutdownCantonAgent, getCantonAgent } from './services/canton/index.js';
import { initBridgeService } from './services/bridge/index.js';
import { logger } from './lib/logger.js';
import { env } from './config/env.js';
import { db } from './db/index.js';

async function main() {
  logger.info({ env: env.NODE_ENV }, 'Starting Canton Wallet Bot');

  // Initialize Canton Agent (connects to ledger with health checks)
  try {
    await initCantonAgent();
    logger.info('Canton Agent initialized with health checks');
  } catch (err) {
    logger.warn({ err }, 'Failed to initialize Canton Agent (will retry on first use)');
  }

  await initBot();
  initWorkers();
  await scheduleUtxoMergeJob();
  await scheduleCantonSyncJob();

  // Initialize Bridge Service (for USDC <-> USDCx bridge)
  try {
    const agent = getCantonAgent();
    const sdk = agent.getSDK();
    const isTestnet = env.CANTON_NETWORK !== 'mainnet';
    initBridgeService(db, sdk, isTestnet);
    logger.info('Bridge service initialized');
  } catch (err) {
    logger.warn({ err }, 'Failed to initialize Bridge service (will retry on first use)');
  }

  // Schedule swap refund job (retries failed refunds)
  // Only runs if TREASURY_PARTY_ID and TREASURY_PRIVATE_KEY are configured
  if (env.TREASURY_PARTY_ID && env.TREASURY_PRIVATE_KEY) {
    await scheduleSwapRefundJob();
    await scheduleTreasuryMonitorJob();
    logger.info('Swap refund and treasury monitor jobs scheduled (treasury configured)');
  } else {
    logger.warn('Swap refund/treasury monitor jobs NOT scheduled (treasury not configured)');
  }

  // Schedule bridge polling job (polls Circle API for attestations)
  await scheduleBridgePollingJob();

  await initServer();

  if (env.NODE_ENV === 'development') {
    logger.info('Starting bot in polling mode');
    await bot.start();
  } else {
    logger.info('Bot running in webhook mode');
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});

function gracefulShutdown(): void {
  logger.info('Shutting down...');
  shutdownCantonAgent();
  void bot.stop().then(() => {
    process.exit(0);
  });
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
