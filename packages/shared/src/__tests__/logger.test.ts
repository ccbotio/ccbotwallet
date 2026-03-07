/**
 * Logger Utility Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, nullLogger, isDebugEnabled } from '../logger/index.js';

describe('Logger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('createLogger', () => {
    it('should create a logger with all methods', () => {
      const logger = createLogger('test-module');

      expect(logger.debug).toBeTypeOf('function');
      expect(logger.info).toBeTypeOf('function');
      expect(logger.warn).toBeTypeOf('function');
      expect(logger.error).toBeTypeOf('function');
    });

    it('should include module name in log output', () => {
      process.env.LOG_LEVEL = 'debug';
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const logger = createLogger('my-module');
      logger.info('Test message');

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0]![0];
      expect(logOutput).toContain('"module":"my-module"');
    });

    it('should include timestamp in log output', () => {
      process.env.LOG_LEVEL = 'debug';
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const logger = createLogger('test');
      logger.info('Test message');

      const logOutput = consoleSpy.mock.calls[0]![0];
      expect(logOutput).toContain('"timestamp"');
    });

    it('should format logs as valid JSON', () => {
      process.env.LOG_LEVEL = 'debug';
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const logger = createLogger('test');
      logger.info('Test message', { key: 'value' });

      const logOutput = consoleSpy.mock.calls[0]![0];
      expect(() => JSON.parse(logOutput)).not.toThrow();

      const parsed = JSON.parse(logOutput);
      expect(parsed.message).toBe('Test message');
      expect(parsed.key).toBe('value');
    });
  });

  describe('Log Levels', () => {
    it('should respect LOG_LEVEL=error (only log errors)', () => {
      process.env.LOG_LEVEL = 'error';
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const logger = createLogger('test');
      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should respect LOG_LEVEL=warn (log warn and error)', () => {
      process.env.LOG_LEVEL = 'warn';
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const logger = createLogger('test');
      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should respect LOG_LEVEL=debug (log everything)', () => {
      process.env.LOG_LEVEL = 'debug';
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const logger = createLogger('test');
      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      expect(debugSpy).toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('should default to info in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.LOG_LEVEL;
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const logger = createLogger('test');
      logger.debug('debug msg');
      logger.info('info msg');

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalled();
    });
  });

  describe('Sensitive Data Sanitization', () => {
    it('should redact privateKey fields', () => {
      process.env.LOG_LEVEL = 'debug';
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const logger = createLogger('test');
      logger.info('Test', { privateKey: 'secret123', userId: 'user1' });

      const logOutput = consoleSpy.mock.calls[0]![0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.privateKey).toBe('[REDACTED]');
      expect(parsed.userId).toBe('user1');
    });

    it('should redact password fields', () => {
      process.env.LOG_LEVEL = 'debug';
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const logger = createLogger('test');
      logger.info('Test', { password: 'mypassword', email: 'test@test.com' });

      const logOutput = consoleSpy.mock.calls[0]![0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.password).toBe('[REDACTED]');
      expect(parsed.email).toBe('test@test.com');
    });

    it('should redact token fields', () => {
      process.env.LOG_LEVEL = 'debug';
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const logger = createLogger('test');
      logger.info('Test', { accessToken: 'jwt.token.here', apiKey: 'key123' });

      const logOutput = consoleSpy.mock.calls[0]![0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.accessToken).toBe('[REDACTED]');
      expect(parsed.apiKey).toBe('[REDACTED]');
    });

    it('should truncate long strings', () => {
      process.env.LOG_LEVEL = 'debug';
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const longString = 'a'.repeat(150);
      const logger = createLogger('test');
      logger.info('Test', { data: longString });

      const logOutput = consoleSpy.mock.calls[0]![0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.data).toContain('...');
      expect(parsed.data).toContain('150 chars');
    });

    it('should truncate party IDs', () => {
      process.env.LOG_LEVEL = 'debug';
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      const partyId = 'party::participant1::namespace1234567890abcdef';
      const logger = createLogger('test');
      logger.info('Test', { partyId });

      const logOutput = consoleSpy.mock.calls[0]![0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.partyId.length).toBeLessThan(partyId.length);
      expect(parsed.partyId).toContain('...');
    });
  });

  describe('Error Logging', () => {
    it('should include error details in log', () => {
      process.env.LOG_LEVEL = 'debug';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const logger = createLogger('test');
      const error = new Error('Something went wrong');
      logger.error('Operation failed', error);

      const logOutput = consoleSpy.mock.calls[0]![0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.error.name).toBe('Error');
      expect(parsed.error.message).toBe('Something went wrong');
    });

    it('should handle non-Error objects', () => {
      process.env.LOG_LEVEL = 'debug';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const logger = createLogger('test');
      logger.error('Operation failed', 'string error');

      const logOutput = consoleSpy.mock.calls[0]![0];
      const parsed = JSON.parse(logOutput);
      expect(parsed.error).toBe('string error');
    });
  });

  describe('nullLogger', () => {
    it('should not output anything', () => {
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      nullLogger.debug('test');
      nullLogger.info('test');
      nullLogger.warn('test');
      nullLogger.error('test');

      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('isDebugEnabled', () => {
    it('should return true when LOG_LEVEL=debug', () => {
      process.env.LOG_LEVEL = 'debug';
      expect(isDebugEnabled()).toBe(true);
    });

    it('should return false when LOG_LEVEL=info', () => {
      process.env.LOG_LEVEL = 'info';
      expect(isDebugEnabled()).toBe(false);
    });

    it('should return false when LOG_LEVEL=error', () => {
      process.env.LOG_LEVEL = 'error';
      expect(isDebugEnabled()).toBe(false);
    });
  });
});
