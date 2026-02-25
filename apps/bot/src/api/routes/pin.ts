import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { jwtAuthMiddleware, getAuthUserId } from '../middleware/jwt-auth.js';
import { apiRateLimitMiddleware } from '../middleware/rate-limit.js';
import { db } from '../../db/index.js';
import { securityEvents } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { recoveryService } from '../../services/recovery/index.js';

// Schema for PIN change audit
const pinChangeAuditSchema = z.object({
  eventStatus: z.enum(['success', 'failed']),
  failureReason: z.string().optional(),
});

// Schema for PIN reset via recovery session
const pinResetSchema = z.object({
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

export const pinRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/pin/reset
   * Validates recovery session and logs PIN reset event.
   * PUBLIC endpoint - uses recovery session for auth.
   * The actual PIN change is done client-side (PIN never sent to server).
   */
  fastify.post('/reset', async (request, reply) => {
    // Validate request body
    let body: z.infer<typeof pinResetSchema>;
    try {
      body = pinResetSchema.parse(request.body);
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
      // Get and validate recovery session
      const session = await recoveryService.getSession(body.sessionId);

      if (!session) {
        return reply.status(404).send({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Recovery session expired or not found' },
        });
      }

      // Session must be in passkey_verified state
      if (session.status !== 'passkey_verified') {
        return reply.status(400).send({
          success: false,
          error: { code: 'INVALID_STATE', message: 'Recovery session not verified' },
        });
      }

      const ipAddress = getClientIp(request);
      const userAgent = request.headers['user-agent'] || 'unknown';

      // Log PIN reset security event
      await db.insert(securityEvents).values({
        userId: session.userId,
        eventType: 'pin_reset',
        eventStatus: 'success',
        severity: 'warning', // PIN reset is a sensitive operation
        ipAddress,
        userAgent,
        metadata: {
          sessionId: session.id,
          method: 'passkey_recovery',
        },
      });

      // Mark recovery session as complete
      await recoveryService.completeRecovery(body.sessionId);

      logger.info(
        { userId: session.userId, sessionId: session.id },
        'PIN reset completed via recovery session'
      );

      return reply.send({
        success: true,
        data: {
          message: 'PIN reset authorized',
          userId: session.userId,
          walletId: session.walletId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset PIN';
      logger.error({ error: message }, 'PIN reset failed');

      return reply.status(500).send({
        success: false,
        error: { code: 'RESET_FAILED', message },
      });
    }
  });

  // Apply JWT auth middleware to remaining PIN routes
  fastify.addHook('preHandler', jwtAuthMiddleware);

  // Apply API rate limiting
  fastify.addHook('preHandler', apiRateLimitMiddleware);

  /**
   * POST /api/pin/change-audit
   * Logs a PIN change event to the security_events table for audit trail.
   * The actual PIN change is done client-side only (PIN never sent to server).
   */
  fastify.post('/change-audit', async (request, reply) => {
    const userId = getAuthUserId(request);

    if (!userId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    // Validate request body
    let body: z.infer<typeof pinChangeAuditSchema>;
    try {
      body = pinChangeAuditSchema.parse(request.body);
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
      // Get client IP and user agent for audit
      const ipAddress = request.ip || request.headers['x-forwarded-for']?.toString() || 'unknown';
      const userAgent = request.headers['user-agent'] || 'unknown';

      // Log security event
      await db.insert(securityEvents).values({
        userId,
        eventType: 'pin_change',
        eventStatus: body.eventStatus,
        ipAddress,
        userAgent,
        metadata: body.failureReason ? { failureReason: body.failureReason } : null,
      });

      logger.info(
        { userId, eventStatus: body.eventStatus },
        'PIN change audit event recorded'
      );

      return reply.send({
        success: true,
        data: {
          message: 'Audit event recorded',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record audit event';
      logger.error({ userId, error: message }, 'Failed to record PIN change audit event');

      return reply.status(500).send({
        success: false,
        error: { code: 'AUDIT_FAILED', message },
      });
    }
  });

  /**
   * GET /api/pin/security-events
   * Get recent security events for the authenticated user.
   */
  fastify.get('/security-events', async (request, reply) => {
    const userId = getAuthUserId(request);

    if (!userId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    try {
      const { eq, desc } = await import('drizzle-orm');

      const events = await db
        .select({
          id: securityEvents.id,
          eventType: securityEvents.eventType,
          eventStatus: securityEvents.eventStatus,
          ipAddress: securityEvents.ipAddress,
          createdAt: securityEvents.createdAt,
        })
        .from(securityEvents)
        .where(eq(securityEvents.userId, userId))
        .orderBy(desc(securityEvents.createdAt))
        .limit(20);

      return reply.send({
        success: true,
        data: { events },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get security events';
      logger.error({ userId, error: message }, 'Failed to get security events');

      return reply.status(500).send({
        success: false,
        error: { code: 'GET_EVENTS_FAILED', message },
      });
    }
  });
};
