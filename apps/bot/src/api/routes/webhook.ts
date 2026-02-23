import type { FastifyPluginAsync } from 'fastify';
import { webhookCallback } from 'grammy';
import { bot } from '../../bot/index.js';

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/telegram', async (request, reply) => {
    const handler = webhookCallback(bot, 'fastify');
    return handler(request, reply);
  });
};
