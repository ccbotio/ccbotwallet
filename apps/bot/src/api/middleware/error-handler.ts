import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '../../lib/logger.js';

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  // Zod validation errors
  if (error instanceof ZodError) {
    return reply.status(400).send({
      success: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'Validation error',
        details: error.flatten(),
      },
    });
  }

  // Known error codes
  if (error.statusCode) {
    return reply.status(error.statusCode).send({
      success: false,
      error: {
        code: error.code ?? 'ERROR',
        message: error.message,
      },
    });
  }

  // Unexpected errors
  logger.error({ err: error, url: request.url, method: request.method }, 'Unhandled error');

  return reply.status(500).send({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
