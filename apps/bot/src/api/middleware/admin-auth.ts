import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../../config/env.js';

declare module 'fastify' {
  interface FastifyRequest {
    isAdmin?: boolean;
  }
}

export interface AdminAuthOptions {
  /** Require API key authentication (default: true) */
  requireApiKey?: boolean;
}

/**
 * Admin authentication middleware for Fastify.
 * Validates x-admin-key header against ADMIN_API_KEY environment variable.
 *
 * SECURITY:
 * - In production, ADMIN_API_KEY must be set and cannot be the default value
 * - Failed authentication attempts are logged for security auditing
 * - Rate limiting should be applied separately to prevent brute force
 */
export async function adminAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  options: AdminAuthOptions = { requireApiKey: true }
) {
  // In production, ensure ADMIN_API_KEY is properly configured
  if (env.NODE_ENV === 'production') {
    if (!env.ADMIN_API_KEY || env.ADMIN_API_KEY === 'dev-admin-key') {
      request.log.error({
        event: 'admin_config_error',
        message: 'ADMIN_API_KEY not properly configured for production',
      });
      return reply.status(500).send({
        success: false,
        error: 'Server configuration error',
        code: 'ADMIN_CONFIG_ERROR',
      });
    }
  }

  if (!options.requireApiKey) {
    return;
  }

  const apiKey = request.headers['x-admin-key'] as string | undefined;

  if (!apiKey) {
    request.log.warn({
      event: 'admin_auth_missing',
      ip: request.ip,
      path: request.url,
    });
    return reply.status(401).send({
      success: false,
      error: 'Admin API key required',
      code: 'ADMIN_AUTH_REQUIRED',
    });
  }

  if (apiKey !== env.ADMIN_API_KEY) {
    request.log.warn({
      event: 'admin_auth_failed',
      ip: request.ip,
      path: request.url,
      userAgent: request.headers['user-agent'],
    });
    return reply.status(403).send({
      success: false,
      error: 'Invalid admin API key',
      code: 'ADMIN_AUTH_INVALID',
    });
  }

  // Mark request as admin-authenticated
  request.isAdmin = true;

  request.log.info({
    event: 'admin_auth_success',
    ip: request.ip,
    path: request.url,
  });
}

/**
 * Check if the current request is admin-authenticated.
 */
export function isAdminRequest(request: FastifyRequest): boolean {
  return request.isAdmin === true;
}

/**
 * Create a preHandler hook that applies admin auth to specific routes.
 * Use this for routes that need optional admin functionality.
 */
export function createAdminAuthHook(options?: AdminAuthOptions) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await adminAuthMiddleware(request, reply, options);
  };
}
