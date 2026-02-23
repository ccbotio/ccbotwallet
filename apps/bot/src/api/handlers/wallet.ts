import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { z } from 'zod';
import { db, wallets, users, transactions } from '../../db/index.js';
import { WalletService } from '../../services/wallet/index.js';
import { getCantonAgent } from '../../services/canton/index.js';
import { getAuthTelegramId, getAuthUserId } from '../middleware/jwt-auth.js';
import { paginationSchema, sendTransactionSchema } from '@repo/shared/validation';
import { queueNotification } from '../../jobs/index.js';
import { logger } from '../../lib/logger.js';

/**
 * Get WalletService instance with Canton Agent's SDK.
 */
function getWalletService(): WalletService {
  const agent = getCantonAgent();
  return new WalletService(agent.getSDK());
}

const createWalletSchema = z.object({
  publicKey: z.string().optional(),
});

const createWalletWithPasskeySchema = z.object({
  pin: z.string().min(6).max(6).optional(), // PIN is optional for passkey-only flow
  credentialId: z.string().min(1),
  publicKeySpki: z.string().min(1),
});

export const walletHandlers = {
  /**
   * POST /wallet/create
   * Create a wallet with Ed25519 key generation and Shamir splitting.
   */
  async createWallet(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);
    const userId = getAuthUserId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const body = createWalletSchema.parse(request.body ?? {});
    const walletService = getWalletService();

    // Find or create user
    let actualUserId = userId;
    if (!actualUserId) {
      const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
      actualUserId = user?.id ?? null;
    }

    if (!actualUserId) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found. Use /start first.' },
      });
    }

    const result = await walletService.createWallet(actualUserId, telegramId, body.publicKey);

    // Queue welcome notification
    try {
      await queueNotification({
        type: 'welcome',
        telegramId,
        data: {},
      });
    } catch (notifyError) {
      logger.error({ err: notifyError }, 'Failed to queue welcome notification');
    }

    return reply.send({
      success: true,
      data: {
        walletId: result.walletId,
        partyId: result.partyId,
        publicKey: result.publicKey,
        userShareHex: result.userShareHex,
        recoveryShareHex: result.recoveryShareHex,
        serverShareIndex: result.serverShareIndex,
      },
    });
  },

  /**
   * POST /wallet/create-with-passkey
   * Create a wallet with an existing passkey credential (NEW FLOW: passkey BEFORE wallet)
   */
  async createWalletWithPasskey(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);
    const userId = getAuthUserId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const body = createWalletWithPasskeySchema.parse(request.body);
    const walletService = getWalletService();

    // Find user and verify email
    let actualUserId = userId;
    let userEmail: string | null = null;

    if (!actualUserId) {
      const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
      actualUserId = user?.id ?? null;
      userEmail = user?.email ?? null;
    } else {
      const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, actualUserId)).limit(1);
      userEmail = user?.email ?? null;
    }

    if (!actualUserId) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found. Use /start first.' },
      });
    }

    // SECURITY: Require verified email before creating wallet with passkey
    if (!userEmail) {
      return reply.status(400).send({
        success: false,
        error: { code: 'EMAIL_REQUIRED', message: 'Email verification required before creating wallet with passkey' },
      });
    }

    // Create wallet first
    const result = await walletService.createWallet(actualUserId, telegramId);

    // Register passkey credential with the new wallet
    try {
      const { passkeyService } = await import('../../services/passkey/index.js');

      // For passkey-only flow, we don't encrypt the user share with passkey
      // The share will be encrypted with PIN on the client side
      // We just register the passkey credential for recovery purposes
      await passkeyService.registerPasskey(
        actualUserId,
        result.walletId,
        userEmail, // SECURITY: Bind passkey to verified email
        body.credentialId,
        body.publicKeySpki,
        '', // No encrypted share needed for passkey-only
        '', // No nonce needed
        result.userShareHex, // Store user share for recovery (encrypted by service)
        'Primary Device'
      );

      logger.info({ walletId: result.walletId, credentialId: body.credentialId }, 'Wallet created with passkey');
    } catch (passkeyError) {
      // Log but don't fail - wallet is still created
      logger.error({ err: passkeyError, walletId: result.walletId }, 'Failed to register passkey with new wallet');
    }

    // Queue welcome notification
    try {
      await queueNotification({
        type: 'welcome',
        telegramId,
        data: {},
      });
    } catch (notifyError) {
      logger.error({ err: notifyError }, 'Failed to queue welcome notification');
    }

    return reply.send({
      success: true,
      data: {
        walletId: result.walletId,
        partyId: result.partyId,
        publicKey: result.publicKey,
        userShare: result.userShareHex,
        recoveryShare: result.recoveryShareHex,
      },
    });
  },

  /**
   * GET /wallet/balance
   */
  async getBalance(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);

    if (!user) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);

    if (!wallet) {
      return reply.status(404).send({
        success: false,
        error: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found' },
      });
    }

    const agent = getCantonAgent();

    // Try to get balance from Canton (or simulation), fallback to 0 if unavailable
    let amount = '0';
    let locked = '0';
    try {
      const balance = await agent.getBalance(wallet.partyId);
      amount = balance.amount;
      locked = balance.locked;
    } catch (error) {
      // Canton network may not be available in development
      console.warn('Failed to fetch balance from Canton:', error);
    }

    return reply.send({
      success: true,
      data: [{ token: 'CC', amount, locked }],
    });
  },

  /**
   * GET /wallet/details
   */
  async getDetails(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);

    if (!user) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);

    if (!wallet) {
      return reply.status(404).send({
        success: false,
        error: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found' },
      });
    }

    return reply.send({
      success: true,
      data: {
        walletId: wallet.id,
        partyId: wallet.partyId,
        publicKey: wallet.publicKey,
        isPrimary: wallet.isPrimary,
        createdAt: wallet.createdAt.toISOString(),
      },
    });
  },

  /**
   * GET /wallet/transactions
   */
  async getTransactions(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);
    const query = paginationSchema.parse(request.query);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (!user) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);

    if (!wallet) {
      return reply.status(404).send({
        success: false,
        error: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found' },
      });
    }

    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.walletId, wallet.id))
      .orderBy(desc(transactions.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    // Serialize transactions with proper ISO date strings
    const serializedTxs = txs.map((tx) => ({
      id: tx.id,
      walletId: tx.walletId,
      type: tx.type as 'send' | 'receive' | 'swap',
      status: tx.status as 'pending' | 'confirmed' | 'failed',
      amount: tx.amount,
      token: tx.token,
      fromParty: tx.fromParty,
      toParty: tx.toParty,
      txHash: tx.txHash,
      metadata: tx.metadata,
      createdAt: tx.createdAt.toISOString(),
      confirmedAt: tx.confirmedAt?.toISOString() ?? null,
    }));

    return reply.send({ success: true, data: serializedTxs });
  },

  /**
   * POST /wallet/send — Legacy endpoint (uses sendTransactionSchema)
   */
  async send(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    sendTransactionSchema.parse(request.body);

    return reply.send({
      success: true,
      data: { txHash: `tx-${String(Date.now())}`, status: 'pending' },
    });
  },

  /**
   * GET /wallet/utxos
   * Get UTXO count for the wallet
   */
  async getUtxoCount(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (!user) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);
    if (!wallet) {
      return reply.status(404).send({
        success: false,
        error: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found' },
      });
    }

    const walletService = getWalletService();
    const utxoCount = await walletService.getUtxoCount(wallet.partyId);

    return reply.send({
      success: true,
      data: {
        utxoCount,
        needsMerge: utxoCount > 10,
        threshold: 10,
      },
    });
  },

  /**
   * POST /wallet/merge
   * Merge UTXOs to optimize wallet
   */
  async mergeUtxos(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const mergeSchema = z.object({
      userShareHex: z.string().min(1),
    });

    const body = mergeSchema.parse(request.body);

    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (!user) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);
    if (!wallet) {
      return reply.status(404).send({
        success: false,
        error: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found' },
      });
    }

    try {
      const walletService = getWalletService();
      const result = await walletService.mergeUtxos(wallet.id, body.userShareHex);

      return await reply.send({
        success: true,
        data: {
          mergedCount: result.mergedCount,
          message:
            result.mergedCount > 0
              ? `Successfully merged ${String(result.mergedCount)} UTXOs`
              : 'No UTXOs needed merging',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Merge failed';
      return await reply.status(500).send({
        success: false,
        error: { code: 'MERGE_FAILED', message },
      });
    }
  },

  /**
   * POST /wallet/faucet
   * Request CC from faucet (simulation/devnet only)
   */
  async requestFaucet(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const faucetSchema = z.object({
      amount: z.string().optional().default('100.0'),
    });

    const body = faucetSchema.parse(request.body ?? {});

    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (!user) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);
    if (!wallet) {
      return reply.status(404).send({
        success: false,
        error: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found' },
      });
    }

    try {
      const agent = getCantonAgent();
      const result = await agent.requestFaucetFunds(wallet.partyId, body.amount);

      if (!result.success) {
        return await reply.status(400).send({
          success: false,
          error: { code: 'FAUCET_FAILED', message: result.message },
        });
      }

      // Queue notification
      try {
        await queueNotification({
          type: 'faucet_received',
          telegramId,
          data: { amount: body.amount },
        });
      } catch (notifyError) {
        logger.error({ err: notifyError }, 'Failed to queue faucet notification');
      }

      return await reply.send({
        success: true,
        data: {
          amount: body.amount,
          txHash: result.txHash,
          message: result.message,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Faucet request failed';
      return await reply.status(500).send({
        success: false,
        error: { code: 'FAUCET_ERROR', message },
      });
    }
  },

  /**
   * POST /wallet/sync
   * Manually trigger transaction sync from Canton ledger
   */
  async syncTransactions(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (!user) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);
    if (!wallet) {
      return reply.status(404).send({
        success: false,
        error: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found' },
      });
    }

    try {
      const { TransactionSyncService } = await import('../../services/sync/index.js');
      const agent = getCantonAgent();
      const syncService = new TransactionSyncService(agent.getSDK());
      const result = await syncService.syncWallet(wallet.id);

      return await reply.send({
        success: true,
        data: {
          synced: result.synced,
          updated: result.updated,
          message: `Synced ${String(result.synced)} new, updated ${String(result.updated)} transactions`,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      return await reply.status(500).send({
        success: false,
        error: { code: 'SYNC_FAILED', message },
      });
    }
  },

  /**
   * POST /wallet/recover
   * Recover wallet using recovery code (share 3).
   * Combines recovery share with server share (share 2) to reconstruct private key,
   * then generates new shares with new PIN encryption.
   */
  async recoverWallet(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const recoverSchema = z.object({
      recoveryShareHex: z.string().min(1, 'Recovery share is required'),
    });

    const body = recoverSchema.parse(request.body);

    // Find user
    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (!user) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    // Find wallet
    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);
    if (!wallet) {
      return reply.status(404).send({
        success: false,
        error: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found' },
      });
    }

    try {
      const walletService = getWalletService();
      const result = await walletService.recoverWallet(wallet.id, body.recoveryShareHex);

      logger.info({ walletId: wallet.id }, 'Wallet recovered successfully');

      return reply.send({
        success: true,
        data: {
          walletId: wallet.id,
          partyId: wallet.partyId,
          publicKey: wallet.publicKey,
          userShareHex: result.userShareHex,
          recoveryShareHex: result.recoveryShareHex,
          serverShareIndex: result.serverShareIndex,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recovery failed';
      logger.error({ err: error, walletId: wallet.id }, 'Wallet recovery failed');
      return reply.status(400).send({
        success: false,
        error: { code: 'RECOVERY_FAILED', message },
      });
    }
  },
};
