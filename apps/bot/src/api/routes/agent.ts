/**
 * AI Agent API Routes
 *
 * Conversational AI agent endpoints for wallet operations.
 */

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { aiAgentService } from '../../services/ai-agent/index.js';
import { jwtAuthMiddleware, getAuthTelegramId } from '../middleware/jwt-auth.js';
import { logger } from '../../lib/logger.js';

// Request schemas
const chatSchema = z.object({
  message: z.string().min(1).max(2000),
});

const confirmSchema = z.object({
  actionId: z.string().uuid(),
  userShareHex: z.string().min(1),
});

const agentRoutes: FastifyPluginAsync = async (fastify) => {
  // Apply JWT auth to all routes
  fastify.addHook('preHandler', jwtAuthMiddleware);

  /**
   * POST /agent/chat
   * Send a message to the AI agent.
   */
  fastify.post('/chat', async (request, reply) => {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: 'Authentication required',
      });
    }

    try {
      const { message } = chatSchema.parse(request.body);

      logger.info({ telegramId, messageLength: message.length }, 'AI Agent chat request');

      const response = await aiAgentService.chat(telegramId, message);

      return {
        success: true,
        data: {
          message: response.message,
          pendingAction: response.pendingAction ? {
            id: response.pendingAction.id,
            type: response.pendingAction.type,
            params: response.pendingAction.params,
            expiresAt: response.pendingAction.expiresAt,
          } : undefined,
          txResult: response.txResult,
          balance: response.balance,
        },
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid message',
          details: error.errors,
        });
      }

      logger.error({ err: error, telegramId }, 'AI Agent chat error');

      return reply.status(500).send({
        success: false,
        error: 'Failed to process message',
      });
    }
  });

  /**
   * POST /agent/confirm
   * Confirm a pending action with PIN (user share).
   */
  fastify.post('/confirm', async (request, reply) => {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: 'Authentication required',
      });
    }

    try {
      const { actionId, userShareHex } = confirmSchema.parse(request.body);

      logger.info({ telegramId, actionId }, 'AI Agent action confirmation');

      const response = await aiAgentService.confirmAction(telegramId, actionId, userShareHex);

      return {
        success: true,
        data: {
          message: response.message,
          txResult: response.txResult,
        },
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid request',
          details: error.errors,
        });
      }

      logger.error({ err: error, telegramId }, 'AI Agent confirm error');

      return reply.status(500).send({
        success: false,
        error: 'Failed to confirm action',
      });
    }
  });

  /**
   * GET /agent/pending
   * Get current pending action for the user.
   */
  fastify.get('/pending', async (request, reply) => {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: 'Authentication required',
      });
    }

    const pendingAction = aiAgentService.getPendingAction(telegramId);

    return {
      success: true,
      data: {
        pendingAction: pendingAction ? {
          id: pendingAction.id,
          type: pendingAction.type,
          params: pendingAction.params,
          expiresAt: pendingAction.expiresAt,
        } : null,
      },
    };
  });

  /**
   * POST /agent/clear
   * Clear conversation context and pending actions.
   */
  fastify.post('/clear', async (request, reply) => {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: 'Authentication required',
      });
    }

    aiAgentService.clearContext(telegramId);

    return {
      success: true,
      data: {
        message: 'Conversation cleared',
      },
    };
  });

  /**
   * GET /agent/usage
   * Get rate limit usage stats for the user.
   */
  fastify.get('/usage', async (request, reply) => {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: 'Authentication required',
      });
    }

    const stats = await aiAgentService.getUsageStats(telegramId);

    return {
      success: true,
      data: {
        transactions: {
          used: stats.transactions.used,
          limit: stats.transactions.limit,
          remaining: stats.transactions.limit - stats.transactions.used,
          resetsIn: stats.transactions.resetIn,
        },
        messages: {
          used: stats.chat.used,
          hourlyLimit: stats.chat.hourlyLimit,
          dailyLimit: stats.chat.dailyLimit,
        },
      },
    };
  });
};

export default agentRoutes;
