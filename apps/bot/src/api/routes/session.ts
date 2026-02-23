import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { jwtAuthMiddleware, getAuthTelegramId, getAuthUserId } from '../middleware/jwt-auth.js';
import { apiRateLimitMiddleware, checkPinRateLimit, resetPinAttempts } from '../middleware/rate-limit.js';
import { sessionLockService } from '../../services/session-lock/index.js';
import { WalletService } from '../../services/wallet/index.js';
import { getCantonAgent } from '../../services/canton/index.js';
import { logger } from '../../lib/logger.js';

/**
 * Get WalletService instance with Canton Agent's SDK.
 */
function getWalletService(): WalletService {
  const agent = getCantonAgent();
  return new WalletService(agent.getSDK());
}

// Schema for updating lock timeout
const updateSettingsSchema = z.object({
  lockTimeoutSeconds: z
    .number()
    .int()
    .min(60, 'Minimum timeout is 60 seconds')
    .max(3600, 'Maximum timeout is 3600 seconds (1 hour)'),
});

// Schema for unlock request - requires user share for PIN verification
const unlockSchema = z.object({
  userShareHex: z.string().min(1, 'User share is required for PIN verification'),
});

export const sessionRoutes: FastifyPluginAsync = async (fastify) => {
  // Apply JWT auth middleware to all session routes
  fastify.addHook('preHandler', jwtAuthMiddleware);

  // Apply API rate limiting to all session routes
  fastify.addHook('preHandler', apiRateLimitMiddleware);

  /**
   * POST /api/session/heartbeat
   * Keep session alive - update last activity timestamp.
   * Should be called periodically by the client (e.g., every 30 seconds).
   */
  fastify.post('/heartbeat', async (request, reply) => {
    const userId = getAuthUserId(request);

    if (!userId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    try {
      await sessionLockService.heartbeat(userId);

      return reply.send({
        success: true,
        data: {
          message: 'Heartbeat recorded',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Heartbeat failed';
      logger.error({ userId, error: message }, 'Heartbeat failed');

      return reply.status(500).send({
        success: false,
        error: { code: 'HEARTBEAT_FAILED', message },
      });
    }
  });

  /**
   * GET /api/session/lock-status
   * Check if the session is locked.
   * Also automatically locks if timeout has been exceeded.
   */
  fastify.get('/lock-status', async (request, reply) => {
    const userId = getAuthUserId(request);

    if (!userId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    try {
      const status = await sessionLockService.checkLockStatus(userId);

      return reply.send({
        success: true,
        data: {
          isLocked: status.isLocked,
          lastActivityAt: status.lastActivityAt.toISOString(),
          lockTimeoutSeconds: status.lockTimeoutSeconds,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check lock status';
      logger.error({ userId, error: message }, 'Lock status check failed');

      return reply.status(500).send({
        success: false,
        error: { code: 'LOCK_STATUS_FAILED', message },
      });
    }
  });

  /**
   * POST /api/session/lock
   * Lock the session immediately.
   */
  fastify.post('/lock', async (request, reply) => {
    const userId = getAuthUserId(request);

    if (!userId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    try {
      await sessionLockService.lock(userId);

      return reply.send({
        success: true,
        data: {
          message: 'Session locked',
          lockedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to lock session';
      logger.error({ userId, error: message }, 'Session lock failed');

      return reply.status(500).send({
        success: false,
        error: { code: 'LOCK_FAILED', message },
      });
    }
  });

  /**
   * POST /api/session/unlock
   * Unlock the session with PIN verification.
   *
   * The PIN verification is delegated to the client-side:
   * - Client decrypts the user share with PIN
   * - Sends the user share hex to prove PIN knowledge
   * - Server validates the share format and unlocks
   *
   * Rate limited: 5 failed attempts = 15 minute lockout
   */
  fastify.post('/unlock', async (request, reply) => {
    const userId = getAuthUserId(request);
    const telegramId = getAuthTelegramId(request);

    if (!userId || !telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    // Check PIN rate limiting
    const rateLimit = await checkPinRateLimit(telegramId);
    if (!rateLimit.allowed) {
      const lockedUntilStr = rateLimit.lockedUntil
        ? new Date(rateLimit.lockedUntil).toISOString()
        : undefined;

      return reply.status(429).send({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many unlock attempts. Please try again later.',
          lockedUntil: lockedUntilStr,
        },
      });
    }

    // Validate request body
    let body: z.infer<typeof unlockSchema>;
    try {
      body = unlockSchema.parse(request.body);
    } catch (error) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid request body',
          remainingAttempts: rateLimit.remainingAttempts,
        },
      });
    }

    try {
      // Validate the user share format
      // The share format is: index:value (both as hex strings)
      const shareParts = body.userShareHex.split(':');
      if (shareParts.length !== 2) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_SHARE',
            message: 'Invalid user share format',
            remainingAttempts: rateLimit.remainingAttempts - 1,
          },
        });
      }

      // Verify share index is 1 (user share)
      const shareIndex = parseInt(shareParts[0] ?? '', 16);
      if (shareIndex !== 1) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_SHARE',
            message: 'Invalid share index',
            remainingAttempts: rateLimit.remainingAttempts - 1,
          },
        });
      }

      // SECURITY: Validate share by reconstructing key and checking public key
      const walletService = getWalletService();
      const validation = await walletService.validateUserShare(userId, body.userShareHex);

      if (!validation.valid) {
        logger.warn(
          { userId, error: validation.error },
          'PIN unlock failed - invalid share'
        );

        // Re-check rate limit to get updated remaining attempts
        const updatedRateLimit = await checkPinRateLimit(telegramId);

        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_SHARE',
            message: 'PIN verification failed',
            remainingAttempts: updatedRateLimit.remainingAttempts,
          },
        });
      }

      // Share is valid - unlock the session
      await sessionLockService.unlock(userId);

      // Reset PIN attempts on successful unlock
      await resetPinAttempts(telegramId);

      logger.info({ userId }, 'Session unlocked via PIN verification');

      return reply.send({
        success: true,
        data: {
          message: 'Session unlocked',
          unlockedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unlock failed';
      logger.error({ userId, error: message }, 'Session unlock failed');

      return reply.status(500).send({
        success: false,
        error: {
          code: 'UNLOCK_FAILED',
          message,
          remainingAttempts: rateLimit.remainingAttempts - 1,
        },
      });
    }
  });

  /**
   * GET /api/session/settings
   * Get current lock timeout settings.
   */
  fastify.get('/settings', async (request, reply) => {
    const userId = getAuthUserId(request);

    if (!userId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    try {
      const lockTimeoutSeconds = await sessionLockService.getLockTimeout(userId);

      return reply.send({
        success: true,
        data: {
          lockTimeoutSeconds,
          // Provide human-readable options
          availableTimeouts: [
            { value: 60, label: '1 minute' },
            { value: 300, label: '5 minutes' },
            { value: 600, label: '10 minutes' },
            { value: 900, label: '15 minutes' },
            { value: 1800, label: '30 minutes' },
            { value: 3600, label: '1 hour' },
          ],
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get settings';
      logger.error({ userId, error: message }, 'Get settings failed');

      return reply.status(500).send({
        success: false,
        error: { code: 'GET_SETTINGS_FAILED', message },
      });
    }
  });

  /**
   * PUT /api/session/settings
   * Update lock timeout settings.
   */
  fastify.put('/settings', async (request, reply) => {
    const userId = getAuthUserId(request);

    if (!userId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    // Validate request body
    let body: z.infer<typeof updateSettingsSchema>;
    try {
      body = updateSettingsSchema.parse(request.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const firstError = error.errors[0];
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: firstError?.message ?? 'Invalid request body',
          },
        });
      }
      throw error;
    }

    try {
      await sessionLockService.setLockTimeout(userId, body.lockTimeoutSeconds);

      return reply.send({
        success: true,
        data: {
          lockTimeoutSeconds: body.lockTimeoutSeconds,
          message: 'Settings updated',
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update settings';
      logger.error({ userId, error: message }, 'Update settings failed');

      return reply.status(500).send({
        success: false,
        error: { code: 'UPDATE_SETTINGS_FAILED', message },
      });
    }
  });
};
