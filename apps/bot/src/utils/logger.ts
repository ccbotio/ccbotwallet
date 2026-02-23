import { randomUUID } from 'node:crypto';
import { logger as baseLogger } from '../lib/logger.js';

/**
 * Create a child logger with correlation ID for request tracing.
 */
export function createRequestLogger(correlationId?: string) {
  const id = correlationId ?? randomUUID();
  return baseLogger.child({ correlationId: id });
}

/**
 * Log a Canton operation with timing.
 */
export function logCantonOperation(
  operation: string,
  partyId: string,
  duration: number,
  success: boolean,
  details?: Record<string, unknown>
) {
  const data = {
    operation,
    partyId,
    duration,
    success,
    ...details,
  };

  if (success) {
    baseLogger.info(data, `Canton ${operation} completed`);
  } else {
    baseLogger.error(data, `Canton ${operation} failed`);
  }
}

/**
 * Log a security event.
 */
export function logSecurityEvent(
  event: string,
  telegramId: string,
  details?: Record<string, unknown>
) {
  baseLogger.warn(
    {
      securityEvent: event,
      telegramId,
      ...details,
    },
    `Security event: ${event}`
  );
}
