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
    const sdk = agent.getSDK();

    // Get all token balances (CC and USDCx)
    const balances: Array<{ token: string; amount: string; locked: string }> = [];

    try {
      // Get CC balance
      const ccBalance = await sdk.getTokenBalance(wallet.partyId, 'CC');
      balances.push({
        token: 'CC',
        amount: ccBalance.amount,
        locked: ccBalance.locked,
      });
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch CC balance from Canton');
      balances.push({ token: 'CC', amount: '0', locked: '0' });
    }

    try {
      // Get USDCx balance
      const usdcxBalance = await sdk.getTokenBalance(wallet.partyId, 'USDCx');
      balances.push({
        token: 'USDCx',
        amount: usdcxBalance.amount,
        locked: usdcxBalance.locked,
      });
    } catch (error) {
      // USDCx may not be available for all users
      logger.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch USDCx balance from Canton');
      balances.push({ token: 'USDCx', amount: '0', locked: '0' });
    }

    return reply.send({
      success: true,
      data: balances,
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

  /**
   * POST /wallet/preapproval
   * Create a TransferPreapproval for the wallet to receive Token Standard transfers.
   */
  async createPreapproval(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

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
      const result = await walletService.createPreapproval(telegramId, wallet.partyId);

      logger.info({ walletId: wallet.id, partyId: wallet.partyId, preapprovalId: result.contractId }, 'Preapproval created');

      return reply.send({
        success: true,
        data: {
          preapprovalContractId: result.contractId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create preapproval';
      logger.error({ err: error, walletId: wallet.id }, 'Preapproval creation failed');
      return reply.status(500).send({
        success: false,
        error: { code: 'PREAPPROVAL_FAILED', message },
      });
    }
  },

  /**
   * GET /wallet/pending-transfers
   * List pending incoming transfers awaiting acceptance.
   */
  async listPendingTransfers(request: FastifyRequest, reply: FastifyReply) {
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
      const walletService = getWalletService();
      const pending = await walletService.listPendingTransfers(wallet.partyId);

      return reply.send({
        success: true,
        data: {
          pendingTransfers: pending,
          count: pending.length,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to list pending transfers';
      logger.error({ err: error, walletId: wallet.id }, 'Failed to list pending transfers');
      return reply.status(500).send({
        success: false,
        error: { code: 'LIST_PENDING_FAILED', message },
      });
    }
  },

  /**
   * POST /wallet/accept-transfers
   * Accept all pending incoming transfers (Token Standard 2-step transfers).
   * This converts TransferInstruction contracts into Holding contracts.
   */
  async acceptPendingTransfers(request: FastifyRequest, reply: FastifyReply) {
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
      const walletService = getWalletService();
      const result = await walletService.acceptPendingTransfers(telegramId, wallet.partyId);

      logger.info(
        { walletId: wallet.id, accepted: result.accepted, failed: result.failed },
        'Pending transfers processed'
      );

      return reply.send({
        success: true,
        data: {
          accepted: result.accepted,
          failed: result.failed,
          errors: result.errors,
          message: result.accepted > 0
            ? `Accepted ${String(result.accepted)} transfer(s)`
            : 'No pending transfers to accept',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to accept transfers';
      logger.error({ err: error, walletId: wallet.id }, 'Failed to accept pending transfers');
      return reply.status(500).send({
        success: false,
        error: { code: 'ACCEPT_FAILED', message },
      });
    }
  },

  /**
   * POST /wallet/reject-transfer
   * Reject a specific pending incoming transfer (Token Standard 2-step transfer).
   * This declines the TransferInstruction, returning funds to sender.
   */
  async rejectPendingTransfer(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const rejectSchema = z.object({
      transferInstructionCid: z.string().min(1, 'Transfer instruction contract ID required'),
      userShareHex: z.string().min(1, 'User share required'),
    });

    const body = rejectSchema.parse(request.body);

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
      const result = await walletService.rejectPendingTransfer(
        wallet.id,
        body.transferInstructionCid,
        body.userShareHex
      );

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'REJECT_FAILED', message: result.error || 'Failed to reject transfer' },
        });
      }

      logger.info(
        { walletId: wallet.id, transferInstructionCid: body.transferInstructionCid },
        'Pending transfer rejected'
      );

      return reply.send({
        success: true,
        data: {
          message: 'Transfer rejected successfully',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reject transfer';
      logger.error({ err: error, walletId: wallet.id }, 'Failed to reject pending transfer');
      return reply.status(500).send({
        success: false,
        error: { code: 'REJECT_FAILED', message },
      });
    }
  },

  /**
   * GET /wallet/preferences
   * Get user wallet preferences (auto-merge, one-step transfers).
   */
  async getPreferences(request: FastifyRequest, reply: FastifyReply) {
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

    return reply.send({
      success: true,
      data: {
        autoMergeUtxo: user.autoMergeUtxo,
        oneStepTransfers: user.oneStepTransfers,
        autoAcceptTransfers: user.autoAcceptTransfers,
      },
    });
  },

  /**
   * PUT /wallet/preferences
   * Update user wallet preferences (auto-merge, one-step transfers).
   */
  async updatePreferences(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const preferencesSchema = z.object({
      autoMergeUtxo: z.boolean().optional(),
      oneStepTransfers: z.boolean().optional(),
      autoAcceptTransfers: z.boolean().optional(),
    });

    const body = preferencesSchema.parse(request.body);

    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    if (!user) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    try {
      const updateData: Record<string, boolean> = {};
      if (body.autoMergeUtxo !== undefined) {
        updateData.autoMergeUtxo = body.autoMergeUtxo;
      }
      if (body.oneStepTransfers !== undefined) {
        updateData.oneStepTransfers = body.oneStepTransfers;
      }
      if (body.autoAcceptTransfers !== undefined) {
        updateData.autoAcceptTransfers = body.autoAcceptTransfers;
      }

      if (Object.keys(updateData).length > 0) {
        await db.update(users).set(updateData).where(eq(users.id, user.id));
      }

      logger.info({ userId: user.id, preferences: updateData }, 'User preferences updated');

      return reply.send({
        success: true,
        data: {
          autoMergeUtxo: body.autoMergeUtxo ?? user.autoMergeUtxo,
          oneStepTransfers: body.oneStepTransfers ?? user.oneStepTransfers,
          autoAcceptTransfers: body.autoAcceptTransfers ?? user.autoAcceptTransfers,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update preferences';
      logger.error({ err: error, userId: user.id }, 'Failed to update preferences');
      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_FAILED', message },
      });
    }
  },
};
