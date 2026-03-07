/**
 * Structured Logger Utility
 *
 * Production-ready logging with:
 * - Configurable log levels (debug, info, warn, error)
 * - JSON format for log aggregation
 * - Sensitive data sanitization
 * - Module-based context
 *
 * Usage:
 * ```typescript
 * import { createLogger } from '@repo/shared';
 * const logger = createLogger('my-module');
 * logger.info('Operation completed', { userId: '123' });
 * ```
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  module?: string;
  operation?: string;
  userId?: string;
  partyId?: string;
  txHash?: string;
  swapId?: string;
  sessionId?: string;
  duration?: number;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error | unknown, context?: LogContext): void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Get current log level from environment.
 * Defaults to 'info' in production, 'debug' in development.
 */
function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL as LogLevel;
  if (LOG_LEVELS[envLevel] !== undefined) {
    return envLevel;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

/**
 * Check if a message at the given level should be logged.
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[getLogLevel()];
}

/**
 * Sensitive field patterns to redact from logs.
 */
const SENSITIVE_PATTERNS = [
  'privateKey',
  'private_key',
  'secretKey',
  'secret_key',
  'password',
  'token',
  'apiKey',
  'api_key',
  'authorization',
  'pin',
  'seed',
  'mnemonic',
  'encryptionKey',
  'encryption_key',
  'shareHex',
  'share_hex',
];

/**
 * Sanitize context object by redacting sensitive fields.
 */
function sanitizeContext(context: LogContext): LogContext {
  const sanitized: LogContext = {};

  for (const [key, value] of Object.entries(context)) {
    // Check if key matches sensitive patterns
    const isSensitive = SENSITIVE_PATTERNS.some(
      (pattern) => key.toLowerCase().includes(pattern.toLowerCase())
    );

    if (isSensitive && value !== undefined) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 100) {
      // Truncate long strings (but preserve first/last chars for debugging)
      sanitized[key] = `${value.slice(0, 20)}...${value.slice(-20)} (${value.length} chars)`;
    } else if (key === 'partyId' && typeof value === 'string' && value.length > 30) {
      // Truncate party IDs for readability
      sanitized[key] = `${value.slice(0, 25)}...`;
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Format a log entry as JSON string.
 */
function formatLog(
  level: LogLevel,
  module: string,
  message: string,
  context?: LogContext,
  error?: Error | unknown
): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    module,
    message,
  };

  if (context && Object.keys(context).length > 0) {
    const sanitized = sanitizeContext(context);
    // Merge context into entry (except module which is already set)
    const { module: _m, ...rest } = sanitized;
    Object.assign(entry, rest);
  }

  if (error) {
    if (error instanceof Error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
      };
    } else {
      entry.error = String(error);
    }
  }

  return JSON.stringify(entry);
}

/**
 * Create a logger instance for a specific module.
 *
 * @param module - Module name for log context (e.g., 'canton-sdk', 'swap-service')
 * @returns Logger instance with debug, info, warn, error methods
 *
 * @example
 * ```typescript
 * const logger = createLogger('swap-service');
 *
 * logger.info('Swap initiated', { swapId: '123', fromToken: 'CC' });
 * logger.error('Swap failed', new Error('Insufficient balance'), { swapId: '123' });
 * ```
 */
export function createLogger(module: string): Logger {
  return {
    debug(message: string, context?: LogContext) {
      if (shouldLog('debug')) {
        console.debug(formatLog('debug', module, message, context));
      }
    },

    info(message: string, context?: LogContext) {
      if (shouldLog('info')) {
        console.info(formatLog('info', module, message, context));
      }
    },

    warn(message: string, context?: LogContext) {
      if (shouldLog('warn')) {
        console.warn(formatLog('warn', module, message, context));
      }
    },

    error(message: string, error?: Error | unknown, context?: LogContext) {
      if (shouldLog('error')) {
        console.error(formatLog('error', module, message, context, error));
      }
    },
  };
}

/**
 * No-op logger for testing or when logging should be disabled.
 */
export const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Check if the current environment should log at debug level.
 */
export function isDebugEnabled(): boolean {
  return shouldLog('debug');
}
