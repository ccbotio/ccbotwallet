import type { FastifyPluginAsync } from 'fastify';
import { notificationHandlers } from '../handlers/notifications.js';
import { jwtAuthMiddleware } from '../middleware/jwt-auth.js';

export const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  // Apply JWT auth middleware to all notification routes
  fastify.addHook('preHandler', jwtAuthMiddleware);

  fastify.get('/', notificationHandlers.list);
  fastify.post('/:id/read', notificationHandlers.markAsRead);
  fastify.post('/read-all', notificationHandlers.markAllAsRead);
};
