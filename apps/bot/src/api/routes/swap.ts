/**
 * Swap API Routes
 *
 * Endpoints for CC <-> USDCx swaps:
 * - GET  /api/swap/quote   - Get swap quote
 * - POST /api/swap/execute - Execute swap
 * - GET  /api/swap/history - Get swap history
 * - GET  /api/swap/status  - Get swap service status
 */

import { z } from 'zod';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { SwapService, type TreasuryConfig } from '../../services/swap/index.js';
import { WalletService } from '../../services/wallet/index.js';
import { OfficialSDKClient } from '@repo/canton-client';
import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { adminAuthMiddleware } from '../middleware/admin-auth.js';
import { logger } from '../../lib/logger.js';

// ==================== Canton SDK Configuration ====================

/**
 * Get required Canton SDK configuration.
 * Throws error if required env vars are missing (fail-fast for production).
 */
function getCantonSDKConfig() {
  if (!env.CANTON_LEDGER_API_URL) {
    throw new Error('CANTON_LEDGER_API_URL is required');
  }
  if (!env.CANTON_VALIDATOR_API_URL) {
    throw new Error('CANTON_VALIDATOR_API_URL is required');
  }

  return {
    network: env.CANTON_NETWORK,
    ledgerApiUrl: env.CANTON_LEDGER_API_URL,
    validatorUrl: env.CANTON_VALIDATOR_API_URL,
    ledgerApiUser: env.CANTON_LEDGER_API_USER || 'ledger-api-user',
    participantId: env.CANTON_PARTICIPANT_ID || 'ccbot-participant',
    validatorAudience: env.CANTON_VALIDATOR_AUDIENCE || '',
  };
}

// ==================== Schemas ====================

const tokenSchema = z.enum(['CC', 'USDCx']);

const quoteQuerySchema = z.object({
  fromToken: tokenSchema,
  toToken: tokenSchema,
  amount: z.string().min(1),
  direction: z.enum(['exactIn', 'exactOut']).default('exactIn'),
});

const executeBodySchema = z.object({
  quoteId: z.string().uuid(),
  userShareHex: z.string().min(1),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

// ==================== Types ====================

interface AuthenticatedRequest extends FastifyRequest {
  userId?: string;
  telegramId?: string;
}

// ==================== Treasury Configuration ====================

function getTreasuryConfig(): TreasuryConfig {
  // Treasury credentials from typed environment
  const treasuryPartyId = env.TREASURY_PARTY_ID || '';
  const treasuryPrivateKey = env.TREASURY_PRIVATE_KEY || '';

  if (!treasuryPartyId || !treasuryPrivateKey) {
    logger.warn('Treasury not configured - swap service disabled. Run: npx tsx scripts/setup-treasury.ts');
  }

  return {
    partyId: treasuryPartyId,
    privateKeyHex: treasuryPrivateKey,
    feePercentage: 0.3, // 0.3% fee
    maxSwapAmountCc: 10000,
    maxSwapAmountUsdcx: 10000,
    minSwapAmountCc: 1,
    minSwapAmountUsdcx: 0.1,
  };
}

// ==================== Route Registration ====================

const swapRoutes: FastifyPluginAsync = async (fastify) => {
  // Initialize SDK with validated config
  const sdk = new OfficialSDKClient(getCantonSDKConfig());

  // Initialize services
  const walletService = new WalletService(sdk);
  const treasuryConfig = getTreasuryConfig();

  // Check if treasury is configured
  const treasuryConfigured = treasuryConfig.partyId && treasuryConfig.privateKeyHex;

  let swapService: SwapService | null = null;

  if (treasuryConfigured) {
    swapService = new SwapService(sdk, db, treasuryConfig);
    await swapService.initialize();
    logger.info('Swap service initialized');
  } else {
    logger.warn('Swap service NOT initialized - treasury not configured');
  }

  /**
   * GET /api/swap/quote
   * Get a swap quote
   */
  fastify.get('/quote', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    if (!swapService) {
      return reply.status(503).send({ error: 'Swap service not configured' });
    }

    const userId = request.userId;
    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    try {
      const query = quoteQuerySchema.parse(request.query);

      // Validate tokens are different
      if (query.fromToken === query.toToken) {
        return reply.status(400).send({ error: 'Cannot swap same token' });
      }

      const quote = await swapService.getQuote(userId, {
        fromToken: query.fromToken,
        toToken: query.toToken,
        amount: query.amount,
        direction: query.direction,
      });

      return reply.send(quote);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: error.errors,
        });
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message }, 'Quote error');

      return reply.status(400).send({ error: message });
    }
  });

  /**
   * POST /api/swap/execute
   * Execute a swap using a quote
   */
  fastify.post('/execute', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    if (!swapService) {
      return reply.status(503).send({ error: 'Swap service not configured' });
    }

    const userId = request.userId;
    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    try {
      const body = executeBodySchema.parse(request.body);

      // Get user's wallet
      const wallet = await walletService.getWalletByUserId(userId);
      if (!wallet) {
        return reply.status(404).send({ error: 'Wallet not found' });
      }

      // Execute swap with key reconstruction
      const result = await swapService.executeSwap(
        userId,
        wallet.id,
        wallet.partyId,
        {
          quoteId: body.quoteId,
          userShareHex: body.userShareHex,
        },
        async (userShareHex: string) => {
          // Reconstruct private key from user share + server share
          return walletService.reconstructPrivateKey(wallet.id, userShareHex);
        }
      );

      if (!result.success) {
        return reply.status(400).send({ error: result.error });
      }

      return reply.send(result);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: error.errors,
        });
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message }, 'Swap execute error');

      return reply.status(500).send({ error: 'Swap execution failed' });
    }
  });

  /**
   * GET /api/swap/history
   * Get user's swap history
   */
  fastify.get('/history', async (request: AuthenticatedRequest, reply: FastifyReply) => {
    if (!swapService) {
      return reply.status(503).send({ error: 'Swap service not configured' });
    }

    const userId = request.userId;
    if (!userId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    try {
      const query = historyQuerySchema.parse(request.query);

      const history = await swapService.getSwapHistory(userId, query.limit, query.offset);

      return reply.send(history);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: error.errors,
        });
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message }, 'Swap history error');

      return reply.status(500).send({ error: 'Failed to fetch swap history' });
    }
  });

  /**
   * GET /api/swap/status
   * Get swap service status (public endpoint)
   */
  fastify.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!swapService) {
      return reply.send({
        isActive: false,
        configured: false,
        message: 'Swap service not configured. Set TREASURY_PARTY_ID and TREASURY_PRIVATE_KEY.',
      });
    }

    try {
      const status = await swapService.getStatus();

      return reply.send({
        isActive: status.isActive,
        configured: true,
        ccPriceUsd: status.ccPriceUsd,
        feePercentage: status.config.feePercentage,
        limits: {
          maxSwapAmountCc: status.config.maxSwapAmountCc,
          maxSwapAmountUsdcx: status.config.maxSwapAmountUsdcx,
          minSwapAmountCc: status.config.minSwapAmountCc,
          minSwapAmountUsdcx: status.config.minSwapAmountUsdcx,
        },
        quoteExpirySeconds: status.config.quoteExpirySeconds,
        // Don't expose treasury balances publicly
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message }, 'Swap status error');

      return reply.status(500).send({ error: 'Failed to fetch swap status' });
    }
  });

  /**
   * GET /api/swap/treasury/stats
   * Get treasury statistics (admin only).
   *
   * SECURITY: Requires x-admin-key header with valid ADMIN_API_KEY
   */
  fastify.get('/treasury/stats', {
    preHandler: async (request, reply) => {
      await adminAuthMiddleware(request, reply);
    },
  }, async (request: AuthenticatedRequest, reply: FastifyReply) => {
    if (!swapService) {
      return reply.status(503).send({ error: 'Swap service not configured' });
    }

    try {
      const status = await swapService.getStatus();

      return reply.send({
        success: true,
        data: {
          treasury: status.treasuryStats,
          config: status.config,
          ccPriceUsd: status.ccPriceUsd,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      request.log.error({ error: message }, 'Treasury stats error');

      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch treasury stats',
      });
    }
  });
};

export default swapRoutes;
