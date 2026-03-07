/**
 * dApp API Routes - CIP-103 Canton dApp Standard
 *
 * Routes for external dApp interaction with CCBot wallet.
 *
 * Public endpoints (no auth):
 * - POST /api/dapp/session - Create session
 * - GET /api/dapp/session/:id - Get session details
 * - POST /api/dapp/session/:id/status - Check status with PKCE
 *
 * Protected endpoints (JWT auth):
 * - POST /api/dapp/session/:id/approve - Approve session
 * - POST /api/dapp/session/:id/reject - Reject session
 * - GET /api/dapp/connections - List connections
 * - DELETE /api/dapp/connections/:id - Disconnect dApp
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { dappSessionService } from '../../services/dapp-session/index.js';
import { jwtAuthMiddleware, getAuthUserId } from '../middleware/jwt-auth.js';
import { db } from '../../db/index.js';
import { wallets } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { createLogger } from '@repo/shared/logger';
import {
  createDappSessionSchema,
  checkSessionStatusSchema,
  approveSessionSchema,
} from '@repo/shared/validation';

const logger = createLogger('dapp-routes');

// Rate limiting constants
const SESSION_CREATE_LIMIT = 10; // per minute per IP
const sessionCreateCounts = new Map<string, { count: number; resetAt: number }>();

function checkSessionRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = sessionCreateCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    sessionCreateCounts.set(ip, { count: 1, resetAt: now + 60000 });
    return true;
  }

  if (entry.count >= SESSION_CREATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

const dappRoutes: FastifyPluginAsync = async (fastify) => {
  // ========== Public Endpoints ==========

  /**
   * POST /session - Create a new dApp session
   *
   * Called by external dApps to initiate interaction.
   * Returns a wallet URL that the user should be redirected to.
   */
  fastify.post('/session', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Rate limiting
      const ip = request.ip;
      if (!checkSessionRateLimit(ip)) {
        return reply.status(429).send({
          success: false,
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Please try again later.',
          },
        });
      }

      // Validate request body
      const body = createDappSessionSchema.parse(request.body);

      // Create session
      const result = await dappSessionService.createSession({
        method: body.method,
        params: body.params,
        origin: body.origin,
        name: body.name,
        icon: body.icon,
        callbackUrl: body.callbackUrl,
        codeChallenge: body.codeChallenge,
        requestId: body.requestId,
        ipAddress: ip,
        userAgent: request.headers['user-agent'],
      });

      logger.info('Session created', {
        sessionId: result.sessionId,
        method: body.method,
        origin: body.origin,
      });

      return {
        success: true,
        data: {
          sessionId: result.sessionId,
          walletUrl: result.walletUrl,
          expiresAt: result.expiresAt.toISOString(),
        },
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid request parameters',
            details: error.errors,
          },
        });
      }

      logger.error('Failed to create session', { error });
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  });

  /**
   * GET /session/:id - Get session details
   *
   * Called by the wallet approval page to display session info.
   */
  fastify.get('/session/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id: sessionId } = request.params as { id: string };

      const session = await dappSessionService.getSession(sessionId);

      if (!session) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'SESSION_NOT_FOUND',
            message: 'Session not found or expired',
          },
        });
      }

      return {
        success: true,
        data: session,
      };
    } catch (error) {
      logger.error('Failed to get session', { error });
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to get session',
        },
      });
    }
  });

  /**
   * POST /session/:id/status - Check session status with PKCE
   *
   * Called by the dApp to poll for session completion.
   * Requires code_verifier for PKCE verification.
   */
  fastify.post('/session/:id/status', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id: sessionId } = request.params as { id: string };
      const body = checkSessionStatusSchema.parse({
        sessionId,
        ...(request.body as object),
      });

      const result = await dappSessionService.checkSessionStatus(
        sessionId,
        body.codeVerifier
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid request parameters',
          },
        });
      }

      logger.error('Failed to check session status', { error });
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to check session status',
        },
      });
    }
  });

  // ========== Protected Endpoints ==========

  /**
   * POST /session/:id/approve - Approve a session
   *
   * Called by the wallet approval page after user confirms.
   * Requires JWT authentication.
   */
  fastify.post(
    '/session/:id/approve',
    { preHandler: jwtAuthMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id: sessionId } = request.params as { id: string };
        const body = approveSessionSchema.parse({
          sessionId,
          ...(request.body as object),
        });

        // Get user and wallet
        const userId = getAuthUserId(request);
        if (!userId) {
          return reply.status(401).send({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
          });
        }

        const [wallet] = await db
          .select()
          .from(wallets)
          .where(eq(wallets.userId, userId))
          .limit(1);

        if (!wallet) {
          return reply.status(404).send({
            success: false,
            error: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found' },
          });
        }

        // Approve session
        const result = await dappSessionService.approveSession(
          sessionId,
          userId,
          wallet.id,
          wallet.partyId,
          body.userShareHex
        );

        if (!result.success) {
          return reply.status(400).send({
            success: false,
            error: result.error,
          });
        }

        return {
          success: true,
          data: {
            redirectUrl: result.redirectUrl,
          },
        };
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply.status(400).send({
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'Invalid request parameters',
            },
          });
        }

        logger.error('Failed to approve session', { error });
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    }
  );

  /**
   * POST /session/:id/reject - Reject a session
   *
   * Called when user declines the dApp request.
   * Requires JWT authentication.
   */
  fastify.post(
    '/session/:id/reject',
    { preHandler: jwtAuthMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id: sessionId } = request.params as { id: string };

        const result = await dappSessionService.rejectSession(sessionId);

        return {
          success: true,
          data: {
            redirectUrl: result.redirectUrl,
          },
        };
      } catch (error) {
        logger.error('Failed to reject session', { error });
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    }
  );

  /**
   * GET /connections - List active dApp connections
   *
   * Returns all dApps connected to the user's wallet.
   */
  fastify.get(
    '/connections',
    { preHandler: jwtAuthMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const userId = getAuthUserId(request);
        if (!userId) {
          return reply.status(401).send({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
          });
        }

        const connections = await dappSessionService.getConnections(userId);

        return {
          success: true,
          data: { connections },
        };
      } catch (error) {
        logger.error('Failed to get connections', { error });
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to get connections',
          },
        });
      }
    }
  );

  /**
   * DELETE /connections/:id - Disconnect a dApp
   *
   * Revokes access for a specific dApp.
   */
  fastify.delete(
    '/connections/:id',
    { preHandler: jwtAuthMiddleware },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { id: connectionId } = request.params as { id: string };

        const userId = getAuthUserId(request);
        if (!userId) {
          return reply.status(401).send({
            success: false,
            error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
          });
        }

        const disconnected = await dappSessionService.disconnectDapp(connectionId, userId);

        if (!disconnected) {
          return reply.status(404).send({
            success: false,
            error: {
              code: 'CONNECTION_NOT_FOUND',
              message: 'Connection not found',
            },
          });
        }

        return {
          success: true,
          data: { disconnected: true },
        };
      } catch (error) {
        logger.error('Failed to disconnect dApp', { error });
        return reply.status(500).send({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to disconnect dApp',
          },
        });
      }
    }
  );
};

export default dappRoutes;
