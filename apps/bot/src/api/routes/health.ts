import type { FastifyPluginCallback } from 'fastify';
import { redis } from '../../lib/redis.js';
import { getCantonAgent } from '../../services/canton/index.js';
import { logger } from '../../lib/logger.js';

export const healthRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  /**
   * GET /health
   * Basic health check
   */
  fastify.get('/', async (_request, reply) => {
    const checks: Record<string, string> = {};

    // Redis check
    try {
      await redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    }

    // DB is checked implicitly by the server running
    checks.server = 'ok';

    const allOk = Object.values(checks).every((v) => v === 'ok');

    return reply.status(allOk ? 200 : 503).send({
      status: allOk ? 'healthy' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /health/canton
   * Canton Network health check
   */
  fastify.get('/canton', async (_request, reply) => {
    try {
      const agent = getCantonAgent();
      const healthStatus = await agent.getHealthStatus();

      return await reply.status(healthStatus.isHealthy ? 200 : 503).send({
        success: true,
        data: healthStatus,
      });
    } catch (error) {
      logger.error({ err: error }, 'Canton health check failed');
      return await reply.status(503).send({
        success: false,
        error: {
          code: 'CANTON_HEALTH_CHECK_FAILED',
          message: 'Failed to check Canton Network health',
        },
      });
    }
  });

  /**
   * GET /health/canton/setup
   * Validate Canton devnet setup
   */
  fastify.get('/canton/setup', async (_request, reply) => {
    try {
      const agent = getCantonAgent();
      const setupStatus = await agent.validateDevnetSetup();

      const isValid =
        setupStatus.ledgerConnected &&
        setupStatus.validatorAccessible &&
        setupStatus.dsoPartyConfigured &&
        setupStatus.providerPartyConfigured;

      return await reply.status(isValid ? 200 : 503).send({
        success: isValid,
        data: setupStatus,
      });
    } catch (error) {
      logger.error({ err: error }, 'Canton setup validation failed');
      return await reply.status(503).send({
        success: false,
        error: {
          code: 'CANTON_SETUP_VALIDATION_FAILED',
          message: 'Failed to validate Canton setup',
        },
      });
    }
  });

  /**
   * GET /health/canton/metrics
   * Get Canton agent metrics
   */
  fastify.get('/canton/metrics', async (_request, reply) => {
    try {
      const agent = getCantonAgent();
      const metrics = await agent.getMetrics();

      return await reply.send({
        success: true,
        data: metrics,
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to get Canton metrics');
      return await reply.status(500).send({
        success: false,
        error: {
          code: 'METRICS_FETCH_FAILED',
          message: 'Failed to fetch Canton metrics',
        },
      });
    }
  });

  /**
   * GET /health/canton/faucet
   * Check faucet availability (devnet only)
   */
  fastify.get('/canton/faucet', async (_request, reply) => {
    try {
      const agent = getCantonAgent();
      const faucetStatus = await agent.checkFaucetAvailability();

      return await reply.send({
        success: true,
        data: faucetStatus,
      });
    } catch (error) {
      logger.error({ err: error }, 'Faucet check failed');
      return await reply.status(500).send({
        success: false,
        error: {
          code: 'FAUCET_CHECK_FAILED',
          message: 'Failed to check faucet availability',
        },
      });
    }
  });

  done();
};
