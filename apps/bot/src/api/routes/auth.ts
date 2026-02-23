import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticateTelegram, refreshAccessToken } from '../../services/auth/index.js';
import { authRateLimitMiddleware } from '../middleware/rate-limit.js';

const telegramAuthSchema = z.object({
  initData: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().uuid(),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Apply rate limiting to all auth routes (per-IP since these are unauthenticated)
  fastify.addHook('preHandler', authRateLimitMiddleware);
  /**
   * POST /auth/telegram
   * Validate Telegram initData and issue JWT tokens.
   */
  fastify.post('/telegram', async (request, reply) => {
    const body = telegramAuthSchema.parse(request.body);

    try {
      const result = await authenticateTelegram(body.initData);

      return reply.send({
        success: true,
        data: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed';
      return reply.status(401).send({
        success: false,
        error: { code: 'AUTH_FAILED', message },
      });
    }
  });

  /**
   * POST /auth/refresh
   * Refresh an access token.
   */
  fastify.post('/refresh', async (request, reply) => {
    const body = refreshSchema.parse(request.body);

    try {
      const result = await refreshAccessToken(body.refreshToken);

      return reply.send({
        success: true,
        data: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          expiresIn: result.expiresIn,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Refresh failed';
      return reply.status(401).send({
        success: false,
        error: { code: 'REFRESH_FAILED', message },
      });
    }
  });
};
