import { bot, initBot } from './bot/index.js';
import { initServer } from './api/server.js';
import { initWorkers, scheduleUtxoMergeJob, scheduleCantonSyncJob } from './jobs/index.js';
import { initCantonAgent, shutdownCantonAgent } from './services/canton/index.js';
import { logger } from './lib/logger.js';
import { env } from './config/env.js';

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
