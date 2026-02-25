/**
 * Recovery Routes
 *
 * PUBLIC (unauthenticated) endpoints for wallet recovery flow:
 * 1. Check email - verify wallet + passkey exists
 * 2. Send code - send verification email
 * 3. Verify code - create recovery session
 * 4. Challenge - get WebAuthn challenge
 * 5. Verify passkey - authenticate and get encrypted share
 *
 * SECURITY:
 * - All endpoints are PUBLIC but heavily rate limited
 * - Recovery sessions expire in 15 minutes
 * - All attempts logged for audit trail
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recoveryService } from '../../services/recovery/index.js';
import { passkeyService } from '../../services/passkey/index.js';
import { logger } from '../../lib/logger.js';

const emailSchema = z.object({
  email: z.string().email('Invalid email format'),
});

const verifyCodeSchema = z.object({
  email: z.string().email('Invalid email format'),
  code: z.string().length(6, 'Code must be 6 digits'),
});

const verifyPasskeySchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
  partyId: z.string().min(1, 'Party ID required'),
  credentialId: z.string().min(1, 'Credential ID required'),
  authenticatorData: z.string().min(1, 'Authenticator data required'),
  clientDataJSON: z.string().min(1, 'Client data required'),
  signature: z.string().min(1, 'Signature required'),
});

const challengeSchema = z.object({
  partyId: z.string().min(1, 'Party ID required'),
  sessionId: z.string().uuid('Invalid session ID'),
});

const completeSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID'),
});

/**
 * Get client IP address from request
 */
function getClientIp(request: { headers: Record<string, string | string[] | undefined>; ip: string }): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() || request.ip;
  }
  const realIp = request.headers['x-real-ip'];
  if (typeof realIp === 'string') {
    return realIp;
  }
  return request.ip;
}

/**
 * Get user agent from request
 */
function getUserAgent(request: { headers: Record<string, string | string[] | undefined> }): string {
  const ua = request.headers['user-agent'];
  return typeof ua === 'string' ? ua : 'unknown';
}

export function recoveryRoutes(fastify: FastifyInstance): void {
  /**
   * POST /api/recovery/check-email
   * Check if email has a wallet with passkey
   * PUBLIC - rate limited
   */
  fastify.post('/check-email', async (request, reply) => {
    try {
      const body = emailSchema.parse(request.body);
      const clientIp = getClientIp(request);

      const result = await recoveryService.checkEmail(body.email, clientIp);

      return reply.send({
        success: true,
        data: result,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: error.errors[0]?.message || 'Invalid input' },
        });
      }
      logger.error({ error }, 'Recovery check-email failed');
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An error occurred' },
      });
    }
  });

  /**
   * POST /api/recovery/send-code
   * Send verification code to email for recovery
   * PUBLIC - strictly rate limited
   */
  fastify.post('/send-code', async (request, reply) => {
    try {
      const body = emailSchema.parse(request.body);
      const clientIp = getClientIp(request);

      const result = await recoveryService.sendCode(body.email, clientIp);

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'SEND_FAILED', message: result.message },
        });
      }

      return reply.send({
        success: true,
        data: {
          message: result.message,
          expiresAt: result.expiresAt,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: error.errors[0]?.message || 'Invalid input' },
        });
      }
      logger.error({ error }, 'Recovery send-code failed');
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An error occurred' },
      });
    }
  });

  /**
   * POST /api/recovery/verify-code
   * Verify email code and create recovery session
   * PUBLIC
   */
  fastify.post('/verify-code', async (request, reply) => {
    try {
      const body = verifyCodeSchema.parse(request.body);
      const clientIp = getClientIp(request);
      const userAgent = getUserAgent(request);

      const result = await recoveryService.verifyCode(body.email, body.code, clientIp, userAgent);

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VERIFY_FAILED', message: result.message },
        });
      }

      return reply.send({
        success: true,
        data: {
          sessionId: result.sessionId,
          partyId: result.partyId,
          walletId: result.walletId,
          message: result.message,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: error.errors[0]?.message || 'Invalid input' },
        });
      }
      logger.error({ error }, 'Recovery verify-code failed');
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An error occurred' },
      });
    }
  });

  /**
   * POST /api/recovery/challenge
   * Generate WebAuthn challenge for passkey authentication
   * Requires valid recovery session
   */
  fastify.post('/challenge', async (request, reply) => {
    try {
      const body = challengeSchema.parse(request.body);

      // Verify session exists and is in correct state
      const session = await recoveryService.getSession(body.sessionId);
      if (!session) {
        return reply.status(404).send({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Recovery session expired or not found' },
        });
      }

      if (session.status !== 'email_verified') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_STATE', message: 'Invalid session state' },
        });
      }

      if (session.partyId !== body.partyId) {
        return reply.status(400).send({
          success: false,
          error: { code: 'PARTY_MISMATCH', message: 'Party ID does not match session' },
        });
      }

      // Generate challenge using existing passkey service
      const challengeResult = await passkeyService.generateChallenge(session.walletId);

      // Get allowed credentials for this wallet
      const credentials = await passkeyService.getCredentials(session.walletId);

      return reply.send({
        success: true,
        data: {
          challenge: challengeResult.challenge,
          allowCredentials: credentials.map(c => ({
            id: c.credentialId,
            type: 'public-key',
          })),
          timeout: 60000, // 60 seconds
          userVerification: 'preferred',
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: error.errors[0]?.message || 'Invalid input' },
        });
      }
      logger.error({ error }, 'Recovery challenge generation failed');
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An error occurred' },
      });
    }
  });

  /**
   * POST /api/recovery/verify-passkey
   * Verify passkey authentication and return encrypted share
   * Requires valid recovery session with email_verified status
   */
  fastify.post('/verify-passkey', async (request, reply) => {
    try {
      const body = verifyPasskeySchema.parse(request.body);
      const clientIp = getClientIp(request);

      const result = await recoveryService.verifyPasskey(
        body.sessionId,
        body.partyId,
        body.credentialId,
        body.authenticatorData,
        body.clientDataJSON,
        body.signature,
        clientIp
      );

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VERIFY_FAILED', message: result.message },
        });
      }

      return reply.send({
        success: true,
        data: {
          encryptedShare: result.encryptedShare,
          nonce: result.nonce,
          walletId: result.walletId,
          userId: result.userId,
          message: result.message,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: error.errors[0]?.message || 'Invalid input' },
        });
      }
      logger.error({ error }, 'Recovery verify-passkey failed');
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An error occurred' },
      });
    }
  });

  /**
   * POST /api/recovery/complete
   * Mark recovery as complete
   */
  fastify.post('/complete', async (request, reply) => {
    try {
      const body = completeSchema.parse(request.body);

      const result = await recoveryService.completeRecovery(body.sessionId);

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'COMPLETE_FAILED', message: result.message },
        });
      }

      return reply.send({
        success: true,
        data: { message: result.message },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: error.errors[0]?.message || 'Invalid input' },
        });
      }
      logger.error({ error }, 'Recovery complete failed');
      return reply.status(500).send({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'An error occurred' },
      });
    }
  });
}
