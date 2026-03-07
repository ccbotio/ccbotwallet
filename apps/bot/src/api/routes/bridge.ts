/**
 * Bridge API Routes
 * Handles Canton <-> Ethereum bridging via Circle xReserve
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import xReserveService, { getBridgeQuote, checkDepositStatus } from '../../services/bridge/xreserve.js';
import { getBridgeService, type BridgeStatus } from '../../services/bridge/index.js';
import { logger } from '../../lib/logger.js';

// JWT authenticated request type
interface AuthenticatedRequest extends FastifyRequest {
  user?: {
    sub: string;
    telegramId: string;
    iat: number;
    exp: number;
  };
}

// Request schemas
const quoteSchema = z.object({
  amount: z.string().min(1),
  fromChain: z.enum(['canton', 'ethereum']),
  toChain: z.enum(['canton', 'ethereum']),
  token: z.string().optional().default('USDC'),
});

const depositSchema = z.object({
  amount: z.string().min(1),
  cantonPartyId: z.string().min(1),
  // In production, this would use secure key management
  // For now, we'll handle signing on the frontend
});

const recordDepositSchema = z.object({
  amount: z.string().min(1),
  cantonPartyId: z.string().min(1),
  fromAddress: z.string().min(1),
  ethTxHash: z.string().min(1),
  fee: z.string().optional(),
});

// All valid BridgeStatus values from the service (exported for testing)
export const BRIDGE_STATUS_VALUES = [
  'deposit_initiated',
  'eth_tx_pending',
  'eth_tx_confirmed',
  'attestation_pending',
  'attestation_received',
  'mint_pending',
  'mint_completed',
  'withdrawal_initiated',
  'burn_pending',
  'burn_completed',
  'eth_release_pending',
  'eth_release_completed',
  'completed',
  'failed',
] as const satisfies readonly BridgeStatus[];

const bridgeStatusEnum = z.enum(BRIDGE_STATUS_VALUES);

const historyQuerySchema = z.object({
  type: z.enum(['deposit', 'withdrawal']).optional(),
  status: bridgeStatusEnum.optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

const bridgeRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /bridge/quote
   * Get a quote for bridging tokens
   */
  fastify.get('/quote', async (request, reply) => {
    const { amount, fromChain, toChain, token: _token } = quoteSchema.parse(request.query);

    // Validate chains are different
    if (fromChain === toChain) {
      return reply.status(400).send({
        error: 'Source and destination chains must be different',
      });
    }

    // Get quote
    const quote = getBridgeQuote(amount, fromChain, toChain);

    return {
      success: true,
      data: {
        ...quote,
        fromChain,
        toChain,
        token: fromChain === 'ethereum' ? 'USDC' : 'USDCx',
        toToken: toChain === 'ethereum' ? 'USDC' : 'USDCx',
      },
    };
  });

  /**
   * GET /bridge/config
   * Get bridge configuration (contract addresses, etc.)
   */
  fastify.get('/config', async (_request, _reply) => {
    const isTestnet = process.env.NODE_ENV !== 'production';

    const config = isTestnet
      ? xReserveService.XRESERVE_CONFIG.testnet
      : xReserveService.XRESERVE_CONFIG.mainnet;

    return {
      success: true,
      data: {
        isTestnet,
        xReserveContract: config.xReserveContract,
        usdcContract: config.usdcContract,
        chainId: config.chain.id,
        rpcUrl: config.rpcUrl,
        domains: xReserveService.DOMAIN_IDS,
        supportedTokens: xReserveService.getSupportedBridgeTokens(),
        supportedChains: [
          { id: 'canton', name: 'Canton Network', domainId: 10001 },
          { id: 'ethereum', name: 'Ethereum', domainId: 0 },
        ],
      },
    };
  });

  /**
   * GET /bridge/status/:txHash
   * Check the status of a bridge transaction
   */
  fastify.get('/status/:txHash', async (request, _reply) => {
    const { txHash } = request.params as { txHash: string };

    const isTestnet = process.env.NODE_ENV !== 'production';
    const status = await checkDepositStatus(txHash, isTestnet);

    return {
      success: true,
      data: status,
    };
  });

  /**
   * POST /bridge/prepare-deposit
   * Prepare a deposit transaction (returns unsigned tx data)
   */
  fastify.post('/prepare-deposit', async (request, _reply) => {
    const { amount, cantonPartyId } = depositSchema.parse(request.body);

    const isTestnet = process.env.NODE_ENV !== 'production';
    const config = isTestnet
      ? xReserveService.XRESERVE_CONFIG.testnet
      : xReserveService.XRESERVE_CONFIG.mainnet;

    // Prepare transaction data for frontend signing
    const amountInUnits = BigInt(Math.floor(parseFloat(amount) * 1e6));
    // Encode Canton party ID as bytes32 for xReserve contract
    const remoteRecipient = `0x${cantonPartyId.replace(/^0x/, '').padStart(64, '0')}`;

    return {
      success: true,
      data: {
        // Step 1: Approve USDC spending
        approvalTx: {
          to: config.usdcContract,
          data: `approve(${config.xReserveContract}, ${amountInUnits})`,
          chainId: config.chain.id,
        },
        // Step 2: Deposit to xReserve
        depositTx: {
          to: config.xReserveContract,
          function: 'depositToRemote',
          args: {
            value: amountInUnits.toString(),
            remoteDomain: xReserveService.DOMAIN_IDS.canton,
            remoteRecipient,
            localToken: config.usdcContract,
            maxFee: '0',
            hookData: `0x${cantonPartyId.replace(/^0x/, '')}`,
          },
          chainId: config.chain.id,
        },
        quote: getBridgeQuote(amount, 'ethereum', 'canton'),
      },
    };
  });

  /**
   * GET /bridge/history
   * Get bridge transaction history for a user
   */
  fastify.get('/history', async (request, reply) => {
    try {
      // Get user from auth context
      const user = (request as AuthenticatedRequest).user;
      if (!user?.sub) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const query = historyQuerySchema.parse(request.query);

      const bridgeService = getBridgeService();
      const result = await bridgeService.getHistory({
        userId: user.sub,
        type: query.type,
        status: query.status,
        limit: query.limit,
        offset: query.offset,
      });

      return {
        success: true,
        data: {
          transactions: result.transactions.map(tx => ({
            id: tx.id,
            type: tx.type,
            status: tx.status,
            fromChain: tx.fromChain,
            toChain: tx.toChain,
            fromAmount: tx.fromAmount,
            toAmount: tx.toAmount,
            fee: tx.fee,
            ethTxHash: tx.ethTxHash,
            cantonTxHash: tx.cantonTxHash,
            attestationStatus: tx.attestationStatus,
            createdAt: tx.createdAt.toISOString(),
            completedAt: tx.completedAt?.toISOString(),
          })),
          total: result.total,
          limit: query.limit,
          offset: query.offset,
        },
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get bridge history');
      return reply.status(500).send({
        error: 'Failed to get bridge history',
      });
    }
  });

  /**
   * POST /bridge/record-deposit
   * Record a new deposit transaction after user submits on Ethereum.
   * Called by frontend after the Ethereum tx is submitted.
   */
  fastify.post('/record-deposit', async (request, reply) => {
    try {
      const user = (request as AuthenticatedRequest).user;
      if (!user?.sub) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const body = recordDepositSchema.parse(request.body);

      const bridgeService = getBridgeService();

      // Check if already recorded
      const existing = await bridgeService.getByEthTxHash(body.ethTxHash);
      if (existing) {
        return {
          success: true,
          data: {
            bridgeId: existing.id,
            status: existing.status,
            message: 'Deposit already recorded',
          },
        };
      }

      // Create deposit record
      const tx = await bridgeService.createDeposit({
        userId: user.sub,
        cantonPartyId: body.cantonPartyId,
        fromAmount: body.amount,
        fromAddress: body.fromAddress,
        ethTxHash: body.ethTxHash,
        fee: body.fee,
      });

      logger.info({ bridgeId: tx.id, ethTxHash: body.ethTxHash }, 'Deposit recorded');

      return {
        success: true,
        data: {
          bridgeId: tx.id,
          status: tx.status,
          message: 'Deposit recorded, polling for attestation',
        },
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to record deposit');
      return reply.status(500).send({
        error: 'Failed to record deposit',
      });
    }
  });

  /**
   * GET /bridge/transaction/:id
   * Get a specific bridge transaction by ID
   */
  fastify.get('/transaction/:id', async (request, reply) => {
    try {
      const user = (request as AuthenticatedRequest).user;
      if (!user?.sub) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params as { id: string };

      const bridgeService = getBridgeService();
      const tx = await bridgeService.getById(id);

      if (!tx) {
        return reply.status(404).send({ error: 'Transaction not found' });
      }

      // Verify ownership
      if (tx.userId !== user.sub) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      return {
        success: true,
        data: {
          id: tx.id,
          type: tx.type,
          status: tx.status,
          fromChain: tx.fromChain,
          toChain: tx.toChain,
          fromAmount: tx.fromAmount,
          toAmount: tx.toAmount,
          fee: tx.fee,
          fromAddress: tx.fromAddress,
          toAddress: tx.toAddress,
          cantonPartyId: tx.cantonPartyId,
          ethTxHash: tx.ethTxHash,
          ethBlockNumber: tx.ethBlockNumber,
          ethConfirmations: tx.ethConfirmations,
          cantonTxHash: tx.cantonTxHash,
          attestationStatus: tx.attestationStatus,
          attestationReceivedAt: tx.attestationReceivedAt?.toISOString(),
          failureReason: tx.failureReason,
          retryCount: tx.retryCount,
          createdAt: tx.createdAt.toISOString(),
          updatedAt: tx.updatedAt.toISOString(),
          completedAt: tx.completedAt?.toISOString(),
        },
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get bridge transaction');
      return reply.status(500).send({
        error: 'Failed to get bridge transaction',
      });
    }
  });

  /**
   * GET /bridge/stats
   * Get bridge service statistics (admin only in production)
   */
  fastify.get('/stats', async (_request, _reply) => {
    try {
      const bridgeService = getBridgeService();
      const stats = await bridgeService.getStats();

      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to get bridge stats');
      return {
        success: true,
        data: {
          totalDeposits: 0,
          totalWithdrawals: 0,
          pendingDeposits: 0,
          pendingWithdrawals: 0,
          failedTransactions: 0,
        },
      };
    }
  });
};

export default bridgeRoutes;
