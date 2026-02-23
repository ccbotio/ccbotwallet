import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { jwtAuthMiddleware, getAuthUserId } from '../middleware/jwt-auth.js';
import { apiRateLimitMiddleware } from '../middleware/rate-limit.js';
import { db } from '../../db/index.js';
import { securityEvents } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';

// Schema for PIN change audit
const pinChangeAuditSchema = z.object({
  eventStatus: z.enum(['success', 'failed']),
  failureReason: z.string().optional(),
});

export const pinRoutes: FastifyPluginAsync = async (fastify) => {
  // Apply JWT auth middleware to all PIN routes
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
