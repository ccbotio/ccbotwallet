import type { FastifyPluginAsync } from 'fastify';
import { userHandlers } from '../handlers/user.js';

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/profile', userHandlers.getProfile);
  fastify.post('/verify', userHandlers.verify);
};
