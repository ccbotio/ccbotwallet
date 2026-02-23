import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, users, wallets } from '../../db/index.js';
import { passkeyService } from '../../services/passkey/index.js';
import { jwtAuthMiddleware, getAuthTelegramId } from '../middleware/jwt-auth.js';
import { logger } from '../../lib/logger.js';

// Validation schemas
const registerSchema = z.object({
  credentialId: z.string().min(1, 'Credential ID is required'),
  publicKeySpki: z.string().min(1, 'Public key is required'),
  encryptedShare: z.string().min(1, 'Encrypted share is required'),
  nonce: z.string().min(1, 'Nonce is required'),
  userShareHex: z.string().min(1, 'User share is required'),
  deviceName: z.string().max(128).optional(),
});

const challengeSchema = z.object({
  partyId: z.string().min(1, 'Party ID is required'),
});

const recoverSchema = z.object({
  partyId: z.string().min(1, 'Party ID is required'),
  credentialId: z.string().min(1, 'Credential ID is required'),
  authenticatorData: z.string().min(1, 'Authenticator data is required'),
  clientDataJson: z.string().min(1, 'Client data JSON is required'),
  signature: z.string().min(1, 'Signature is required'),
  userHandle: z.string().optional(),
});

const revokeSchema = z.object({
  userShareHex: z.string().optional(),
});

export const passkeyRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /passkey/register
   * Register a passkey for wallet recovery.
   * Requires JWT authentication.
   */
  fastify.post('/register', { preHandler: jwtAuthMiddleware }, async (request, reply) => {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const body = registerSchema.parse(request.body);

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

    // SECURITY: Require verified email for passkey registration
    if (!user.email) {
      return reply.status(400).send({
        success: false,
        error: { code: 'EMAIL_REQUIRED', message: 'Email verification required before registering passkey' },
      });
    }

    try {
      const result = await passkeyService.registerPasskey(
        user.id,
        wallet.id,
        user.email, // SECURITY: Bind passkey to verified email
        body.credentialId,
        body.publicKeySpki,
        body.encryptedShare,
        body.nonce,
        body.userShareHex,
        body.deviceName
      );

      logger.info({ walletId: wallet.id, credentialId: body.credentialId.slice(0, 16) }, 'Passkey registered');

      return reply.status(201).send({
        success: true,
        data: {
          id: result.id,
          contractId: result.cantonContractId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to register passkey';
      logger.error({ error: message, walletId: wallet.id }, 'Passkey registration failed');
      return reply.status(500).send({
        success: false,
        error: { code: 'REGISTRATION_FAILED', message },
      });
    }
  });

  /**
   * POST /passkey/challenge
   * Generate a WebAuthn challenge for passkey authentication.
   * Can be called without authentication (for recovery flow).
   */
  fastify.post('/challenge', async (request, reply) => {
    const body = challengeSchema.parse(request.body);

    // Find wallet by party ID
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.partyId, body.partyId))
      .limit(1);

    if (!wallet) {
      return reply.status(404).send({
        success: false,
        error: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found' },
      });
    }

    // Get registered credentials for this wallet
    const credentials = await passkeyService.getCredentials(wallet.id);

    if (credentials.length === 0) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NO_PASSKEYS', message: 'No passkeys registered for this wallet' },
      });
    }

    try {
      const { challenge, expiresAt } = await passkeyService.generateChallenge(wallet.id);

      return reply.send({
        success: true,
        data: {
          challenge,
          expiresAt: expiresAt.toISOString(),
          allowCredentials: credentials.map((c) => ({
            credentialId: c.credentialId,
            type: 'public-key' as const,
          })),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate challenge';
      return reply.status(500).send({
        success: false,
        error: { code: 'CHALLENGE_FAILED', message },
      });
    }
  });

  /**
   * POST /passkey/recover
   * Recover wallet using passkey authentication.
   * Returns encrypted recovery share after WebAuthn verification.
   */
  fastify.post('/recover', async (request, reply) => {
    const body = recoverSchema.parse(request.body);

    try {
      const result = await passkeyService.recoverWithPasskey(body.partyId, {
        credentialId: body.credentialId,
        authenticatorData: body.authenticatorData,
        clientDataJson: body.clientDataJson,
        signature: body.signature,
        userHandle: body.userHandle,
      });

      logger.info({ partyId: body.partyId }, 'Passkey recovery successful');

      return reply.send({
        success: true,
        data: {
          encryptedShare: result.encryptedShare,
          nonce: result.nonce,
          walletId: result.walletId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Recovery failed';
      logger.error({ error: message, partyId: body.partyId }, 'Passkey recovery failed');

      // Don't reveal if wallet exists or not for security
      return reply.status(401).send({
        success: false,
        error: { code: 'RECOVERY_FAILED', message: 'Passkey verification failed' },
      });
    }
  });

  /**
   * GET /passkey/credentials
   * List all passkey credentials for the authenticated user's wallet.
   * Requires JWT authentication.
   */
  fastify.get('/credentials', { preHandler: jwtAuthMiddleware }, async (request, reply) => {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

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

    const credentials = await passkeyService.getCredentials(wallet.id);

    return reply.send({
      success: true,
      data: {
        credentials: credentials.map((c) => ({
          id: c.id,
          credentialId: c.credentialId,
          deviceName: c.deviceName,
          lastUsedAt: c.lastUsedAt?.toISOString() || null,
          createdAt: c.createdAt.toISOString(),
        })),
      },
    });
  });

  /**
   * GET /passkey/credentials/:partyId
   * List passkey credentials for a wallet by party ID.
   * Public endpoint for recovery flow (only returns credential IDs).
   */
  fastify.get('/credentials/:partyId', async (request, reply) => {
    const params = z.object({ partyId: z.string() }).parse(request.params);

    const credentials = await passkeyService.getCredentialsByPartyId(params.partyId);

    if (credentials.length === 0) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NO_PASSKEYS', message: 'No passkeys found' },
      });
    }

    return reply.send({
      success: true,
      data: {
        credentials: credentials.map((c) => ({
          credentialId: c.credentialId,
        })),
      },
    });
  });

  /**
   * DELETE /passkey/credentials/:credentialId
   * Revoke a passkey credential.
   * Requires JWT authentication.
   */
  fastify.delete('/credentials/:credentialId', { preHandler: jwtAuthMiddleware }, async (request, reply) => {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const params = z.object({ credentialId: z.string() }).parse(request.params);
    const body = revokeSchema.parse(request.body || {});

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

    try {
      await passkeyService.revokeCredential(
        params.credentialId,
        wallet.id,
        body.userShareHex
      );

      logger.info({ credentialId: params.credentialId.slice(0, 16) }, 'Passkey revoked');

      return reply.send({
        success: true,
        data: { message: 'Passkey revoked successfully' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revoke passkey';
      return reply.status(500).send({
        success: false,
        error: { code: 'REVOKE_FAILED', message },
      });
    }
  });

  /**
   * POST /passkey/verify-challenge
   * Verify that a challenge is still valid (for debugging/testing).
   * Requires JWT authentication.
   */
  fastify.post('/verify-challenge', { preHandler: jwtAuthMiddleware }, async (request, reply) => {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    const body = z.object({ challenge: z.string() }).parse(request.body);

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

    // Note: This will mark the challenge as used, so only call once
    const isValid = await passkeyService.validateChallenge(wallet.id, body.challenge);

    return reply.send({
      success: true,
      data: { valid: isValid },
    });
  });
};
