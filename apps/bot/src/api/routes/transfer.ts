import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, users, wallets } from '../../db/index.js';
import { TransferService } from '../../services/transfer/index.js';
import { WalletService } from '../../services/wallet/index.js';
import { getCantonSDK } from '../../services/canton/index.js';
import { jwtAuthMiddleware, getAuthTelegramId } from '../middleware/jwt-auth.js';
import { transactionRateLimitMiddleware } from '../middleware/rate-limit.js';
import { amountSchema, partyIdSchema } from '@repo/shared/validation';

const tokenSchema = z.enum(['CC', 'USDCx']).default('CC');

const sendSchema = z.object({
  receiverPartyId: partyIdSchema,
  amount: amountSchema,
  userShareHex: z.string().min(1),
  memo: z.string().max(256).optional(),
  token: tokenSchema,
});

const devSendSchema = z.object({
  receiverPartyId: partyIdSchema,
  amount: amountSchema,
  memo: z.string().max(256).optional(),
  token: tokenSchema,
});

export const transferRoutes: FastifyPluginAsync = async (fastify) => {
  // Apply JWT auth middleware to all transfer routes
  fastify.addHook('preHandler', jwtAuthMiddleware);

  // Apply transaction rate limiting to all transfer routes
  fastify.addHook('preHandler', transactionRateLimitMiddleware);

  /**
   * POST /transfer/send
   * Execute a CC transfer using Shamir key reconstruction.
   */
  fastify.post('/send', async (request, reply) => {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const body = sendSchema.parse(request.body);

    // Get user and wallet
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

    const sdk = getCantonSDK();
    const walletService = new WalletService(sdk);
    const transferService = new TransferService(sdk, walletService);

    try {
      const result = await transferService.sendToken(
        wallet.id,
        body.receiverPartyId,
        body.amount,
        body.userShareHex,
        body.token,
        body.memo
      );

      return reply.send({
        success: true,
        data: {
          transactionId: result.transactionId,
          txHash: result.txHash,
          status: result.status,
          token: body.token,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transfer failed';
      return reply.status(500).send({
        success: false,
        error: { code: 'TRANSACTION_FAILED', message },
      });
    }
  });

  /**
   * GET /transfer/history
   */
  fastify.get('/history', async (request, reply) => {
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

    const sdk = getCantonSDK();
    const walletService = new WalletService(sdk);
    const transferService = new TransferService(sdk, walletService);

    const history = await transferService.getHistory(wallet.id);

    return reply.send({ success: true, data: history });
  });

  /**
   * POST /transfer/dev-send
   * DEV MODE ONLY: Execute a CC transfer without user share.
   * Uses derived private key directly.
   */
  fastify.post('/dev-send', async (request, reply) => {
    // Only allow in development
    if (process.env.NODE_ENV === 'production') {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Dev endpoint not available in production' },
      });
    }

    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const body = devSendSchema.parse(request.body);

    const sdk = getCantonSDK();
    const walletService = new WalletService(sdk);
    const transferService = new TransferService(sdk, walletService);

    try {
      const result = await transferService.sendTokenDevMode(
        telegramId,
        body.receiverPartyId,
        body.amount,
        body.token,
        body.memo
      );

      return reply.send({
        success: true,
        data: {
          transactionId: result.transactionId,
          txHash: result.txHash,
          status: result.status,
          token: body.token,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transfer failed';
      return reply.status(500).send({
        success: false,
        error: { code: 'TRANSACTION_FAILED', message },
      });
    }
  });
};
