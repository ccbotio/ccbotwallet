/**
 * Admin API Routes
 *
 * Administrative endpoints for system configuration.
 * All endpoints are protected with admin API key authentication.
 *
 * SECURITY:
 * - Requires x-admin-key header with valid ADMIN_API_KEY
 * - In production, ADMIN_API_KEY must be set and cannot be default value
 * - All requests are logged for security auditing
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { OfficialSDKClient } from '@repo/canton-client';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { ed25519 } from '@noble/curves/ed25519';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { adminAuthMiddleware } from '../middleware/admin-auth.js';

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

const setupTreasurySchema = z.object({
  // Optional: provide existing private key, otherwise generate new one
  privateKeyHex: z.string().length(64).optional(),
  partyHint: z.string().default('treasury'),
});

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  // Apply admin auth middleware to ALL routes in this plugin
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    await adminAuthMiddleware(request, reply);
  });

  /**
   * POST /admin/treasury/setup
   * Create and configure the treasury party.
   *
   * This endpoint:
   * 1. Generates or uses provided Ed25519 keypair
   * 2. Creates Canton party on the network
   * 3. Returns configuration for .env
   */
  fastify.post('/treasury/setup', async (request, reply) => {
    // Admin auth is handled by preHandler hook

    try {
      const body = setupTreasurySchema.parse(request.body ?? {});

      logger.info('Setting up treasury party...');

      // Step 1: Generate or use provided keypair
      let privateKeyHex: string;
      let publicKeyHex: string;

      if (body.privateKeyHex) {
        privateKeyHex = body.privateKeyHex;
        const privateKey = Buffer.from(privateKeyHex, 'hex');
        const publicKey = ed25519.getPublicKey(privateKey);
        publicKeyHex = bytesToHex(publicKey);
        logger.info('Using provided private key');
      } else {
        const privateKey = randomBytes(32);
        const publicKey = ed25519.getPublicKey(privateKey);
        privateKeyHex = bytesToHex(privateKey);
        publicKeyHex = bytesToHex(publicKey);
        logger.info('Generated new keypair');
      }

      // Step 2: Initialize SDK and create party
      const sdk = new OfficialSDKClient(getCantonSDKConfig());

      await sdk.initialize();
      logger.info('Connected to Canton Network');

      // Create external party
      const result = await sdk.createExternalParty(privateKeyHex, body.partyHint);
      logger.info({ partyId: result.partyId }, 'Treasury party created');

      // Step 3: Create preapproval for receiving tokens
      try {
        await sdk.createPreapproval(result.partyId, privateKeyHex);
        logger.info('Transfer preapproval created');
      } catch (preapprovalError) {
        logger.warn({ err: preapprovalError }, 'Failed to create preapproval (may already exist)');
      }

      return {
        success: true,
        data: {
          partyId: result.partyId,
          publicKeyHex,
          privateKeyHex,
          envConfig: {
            TREASURY_PARTY_ID: result.partyId,
            TREASURY_PRIVATE_KEY: privateKeyHex,
          },
          nextSteps: [
            'Add TREASURY_PARTY_ID and TREASURY_PRIVATE_KEY to .env',
            'Fund treasury with CC via validator wallet or faucet',
            'Fund treasury with USDCx via bridge',
            'Restart bot service',
          ],
        },
      };
    } catch (error) {
      logger.error({ err: error }, 'Failed to setup treasury');
      return reply.status(500).send({
        error: 'Failed to setup treasury',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /admin/treasury/status
   * Get current treasury configuration status.
   */
  fastify.get('/treasury/status', async (_request, _reply) => {
    // Admin auth is handled by preHandler hook

    const treasuryPartyId = env.TREASURY_PARTY_ID;
    const treasuryConfigured = !!treasuryPartyId && !!env.TREASURY_PRIVATE_KEY;

    if (!treasuryConfigured) {
      return {
        success: true,
        data: {
          configured: false,
          message: 'Treasury not configured. Run POST /admin/treasury/setup',
        },
      };
    }

    try {
      // Check treasury balance
      const sdk = new OfficialSDKClient(getCantonSDKConfig());

      await sdk.initialize();
      const balances = await sdk.getAllBalances(treasuryPartyId);

      return {
        success: true,
        data: {
          configured: true,
          partyId: treasuryPartyId,
          balances: {
            cc: balances.cc.amount,
            usdcx: balances.usdcx.amount,
          },
          hasLiquidity: {
            cc: parseFloat(balances.cc.amount) > 0,
            usdcx: parseFloat(balances.usdcx.amount) > 0,
          },
        },
      };
    } catch (error) {
      return {
        success: true,
        data: {
          configured: true,
          partyId: treasuryPartyId,
          error: 'Failed to fetch balances',
        },
      };
    }
  });

  /**
   * POST /admin/treasury/fund
   * Instructions for funding treasury (manual process).
   *
   * Treasury funding must be done through:
   * 1. Validator wallet UI - send CC to treasury party
   * 2. Bridge - deposit USDC to get USDCx
   */
  fastify.post('/treasury/fund', async (_request, reply) => {
    // Admin auth is handled by preHandler hook

    const treasuryPartyId = env.TREASURY_PARTY_ID;

    if (!treasuryPartyId) {
      return reply.status(400).send({
        error: 'Treasury not configured',
      });
    }

    // Determine wallet URL based on network
    const walletUrl = env.CANTON_NETWORK === 'mainnet'
      ? 'https://wallet.canton.network'
      : env.CANTON_NETWORK === 'testnet'
        ? 'https://wallet.testnet.canton.network'
        : 'http://wallet.localhost'; // devnet

    return {
      success: true,
      data: {
        message: 'Treasury funding instructions',
        treasuryPartyId,
        network: env.CANTON_NETWORK,
        instructions: [
          `1. Open validator wallet at ${walletUrl}`,
          '2. Navigate to Transfer',
          `3. Send CC to: ${treasuryPartyId}`,
          '4. For USDCx: use the bridge to deposit USDC from Ethereum',
        ],
        note: 'Automatic faucet funding not available. Use validator wallet.',
      },
    };
  });
};


export default adminRoutes;
