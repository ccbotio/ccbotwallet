import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, type JWTPayload } from '../../services/auth/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    jwtPayload?: JWTPayload;
  }
}

/**
 * JWT authentication middleware for Fastify.
 * Validates Bearer token and attaches payload to request.
 */
export async function jwtAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' },
    });
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyAccessToken(token);
    request.jwtPayload = payload;
  } catch {
    return reply.status(401).send({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
    });
  }
}

/**
 * Get the authenticated user's telegram ID from JWT.
 * SECURITY: Only trust JWT payload, never trust headers directly.
 */
export function getAuthTelegramId(request: FastifyRequest): string | null {
  return request.jwtPayload?.telegramId ?? null;
}

/**
 * Get the authenticated user's ID from JWT.
 */
export function getAuthUserId(request: FastifyRequest): string | null {
  return request.jwtPayload?.sub ?? null;
}
