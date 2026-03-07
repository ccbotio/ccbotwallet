/**
 * ANS (Amulet Name Service) API Routes
 *
 * Canton Network name registration and lookup endpoints.
 * Based on official Canton ANS API specification.
 *
 * Public endpoints (no auth required):
 * - GET /config - Get ANS configuration
 * - GET /check/:name - Check name availability
 * - GET /lookup/:name - Lookup name details
 * - GET /reverse/:partyId - Reverse lookup by party ID
 * - GET /search - Search names by prefix
 * - GET /validate/:name - Validate name format
 *
 * Authenticated endpoints (JWT required):
 * - POST /register - Register a new name
 * - GET /my-names - List user's registered names
 */

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import ansService from '../../services/ans/index.js';
import { logger } from '../../lib/logger.js';
import { db, users, wallets } from '../../db/index.js';
import { jwtAuthMiddleware, getAuthTelegramId } from '../middleware/jwt-auth.js';

// =============================================================================
// REQUEST VALIDATION SCHEMAS
// =============================================================================

const registerSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(63, 'Name cannot exceed 63 characters')
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, 'Invalid name format'),
  url: z
    .string()
    .max(255, 'URL cannot exceed 255 characters')
    .optional()
    .default(''),
  description: z
    .string()
    .max(140, 'Description cannot exceed 140 characters')
    .optional()
    .default(''),
});

const searchSchema = z.object({
  prefix: z.string().min(1, 'Search prefix is required'),
  limit: z.coerce.number().min(1).max(50).optional().default(10),
});

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

const ansRoutes: FastifyPluginAsync = async (fastify) => {
  // ===========================================================================
  // PUBLIC ENDPOINTS
  // ===========================================================================

  /**
   * GET /ans/config
   * Get ANS configuration, pricing, and rules
   */
  fastify.get('/config', async (_request, reply) => {
    try {
      const [pricing, rules] = await Promise.all([
        ansService.getPricingInfo(),
        ansService.getAnsRules(),
      ]);

      const config = ansService.getConfig();

      return {
        success: true,
        data: {
          nameSuffix: config.nameSuffix,
          displaySuffix: config.displaySuffix,
          isDevnet: config.isDevnet,
          validation: config.validation,
          pricing: pricing ?? {
            entryFee: 'Unknown',
            entryFeeCC: 0,
            lifetimeDays: 0,
            renewalDays: 0,
          },
          rules: rules ?? null,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Error fetching ANS config');
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch ANS configuration',
      });
    }
  });

  /**
   * GET /ans/check/:name
   * Check if a name is available for registration
   */
  fastify.get('/check/:name', async (request, reply) => {
    const { name } = request.params as { name: string };

    try {
      // First validate the name format
      const validation = ansService.validateName(name);
      if (!validation.valid) {
        return reply.status(400).send({
          success: false,
          available: false,
          name,
          fullName: null,
          error: validation.error,
        });
      }

      // Check availability on Canton Network
      const result = await ansService.checkNameAvailability(name);

      return {
        success: true,
        name,
        fullName: ansService.getFullName(name),
        displayName: ansService.getDisplayName(name),
        available: result.available,
        error: result.error,
      };
    } catch (error) {
      logger.error({ error, name }, 'Error checking name availability');
      return reply.status(500).send({
        success: false,
        error: 'Failed to check name availability',
      });
    }
  });

  /**
   * GET /ans/lookup/:name
   * Lookup a registered name and get party details
   */
  fastify.get('/lookup/:name', async (request, reply) => {
    const { name } = request.params as { name: string };

    try {
      const result = await ansService.lookupName(name);

      if (!result.found) {
        return reply.status(404).send({
          success: false,
          error: 'Name not found',
          name,
          fullName: ansService.getFullName(name),
        });
      }

      return {
        success: true,
        data: {
          name: result.entry?.name,
          baseName: ansService.getBaseName(result.entry?.name ?? ''),
          partyId: result.partyId,
          url: result.entry?.url,
          description: result.entry?.description,
          expiresAt: result.entry?.expiresAt,
          contractId: result.entry?.contractId,
        },
      };
    } catch (error) {
      logger.error({ error, name }, 'Error looking up name');
      return reply.status(500).send({
        success: false,
        error: 'Failed to lookup name',
      });
    }
  });

  /**
   * GET /ans/reverse/:partyId
   * Reverse lookup - get names associated with a party ID
   */
  fastify.get('/reverse/:partyId', async (request, reply) => {
    const { partyId } = request.params as { partyId: string };

    try {
      const result = await ansService.reverseLookup(partyId);

      return {
        success: true,
        partyId,
        found: result.found,
        names: result.names ?? [],
        primaryName: result.names?.[0] ?? null,
      };
    } catch (error) {
      logger.error({ error, partyId }, 'Error in reverse lookup');
      return reply.status(500).send({
        success: false,
        error: 'Failed to perform reverse lookup',
      });
    }
  });

  /**
   * GET /ans/search
   * Search names by prefix
   */
  fastify.get('/search', async (request, reply) => {
    try {
      const { prefix, limit } = searchSchema.parse(request.query);
      const result = await ansService.searchByPrefix(prefix, limit);

      return {
        success: true,
        data: {
          prefix,
          entries: result.entries.map(entry => ({
            name: entry.name,
            baseName: ansService.getBaseName(entry.name),
            partyId: entry.user,
            url: entry.url,
            description: entry.description,
          })),
          count: result.entries.length,
          hasMore: result.hasMore,
        },
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid search parameters',
          details: error.errors,
        });
      }
      logger.error({ error }, 'Error searching names');
      return reply.status(500).send({
        success: false,
        error: 'Failed to search names',
      });
    }
  });

  /**
   * GET /ans/validate/:name
   * Validate a name format without checking availability
   */
  fastify.get('/validate/:name', async (request, _reply) => {
    const { name } = request.params as { name: string };
    const validation = ansService.validateName(name);

    return {
      success: true,
      name,
      fullName: validation.valid ? ansService.getFullName(name) : null,
      displayName: validation.valid ? ansService.getDisplayName(name) : null,
      valid: validation.valid,
      error: validation.error,
    };
  });

  // ===========================================================================
  // AUTHENTICATED ENDPOINTS
  // ===========================================================================

  /**
   * POST /ans/register
   * Register a new ANS name
   *
   * Flow:
   * 1. Validates the name format
   * 2. Checks availability on Canton Network
   * 3. Creates entry and subscription request via Validator API
   * 4. Returns contract IDs for wallet payment confirmation
   *
   * The user must then accept the payment in their Canton Wallet
   * to complete the registration.
   */
  fastify.post('/register', { preHandler: jwtAuthMiddleware }, async (request, reply) => {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    try {
      // Get user and wallet to retrieve partyId
      const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
      if (!user) {
        return reply.status(404).send({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
        });
      }

      const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);
      if (!wallet) {
        return reply.status(404).send({
          success: false,
          error: 'Wallet not found. Please create a wallet first.',
          code: 'WALLET_NOT_FOUND',
        });
      }

      // Validate request body
      const body = registerSchema.parse(request.body);

      // Validate name format
      const validation = ansService.validateName(body.name);
      if (!validation.valid) {
        return reply.status(400).send({
          success: false,
          error: validation.error,
          code: 'INVALID_NAME',
        });
      }

      // Check availability
      const availability = await ansService.checkNameAvailability(body.name);
      if (!availability.available) {
        return reply.status(409).send({
          success: false,
          error: availability.error ?? 'Name is not available',
          code: 'NAME_UNAVAILABLE',
          name: body.name,
          fullName: ansService.getFullName(body.name),
        });
      }

      // Create entry via Validator API using user's partyId
      const result = await ansService.createEntry(
        body.name,
        body.url,
        body.description,
        wallet.partyId  // User's Canton partyId from wallet
      );

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error,
          code: 'REGISTRATION_FAILED',
        });
      }

      // Return success with contract IDs for wallet confirmation
      return {
        success: true,
        data: {
          name: result.data?.name,
          baseName: body.name,
          fullName: ansService.getFullName(body.name),
          displayName: ansService.getDisplayName(body.name),
          url: result.data?.url,
          description: result.data?.description,
          // Contract IDs for wallet payment
          entryContextCid: result.data?.entryContextCid,
          subscriptionRequestCid: result.data?.subscriptionRequestCid,
          // Instructions for user
          message: 'Registration initiated. Please confirm the payment in your Canton Wallet to complete registration.',
          nextStep: 'WALLET_CONFIRMATION',
        },
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid request body',
          code: 'VALIDATION_ERROR',
          details: error.errors,
        });
      }

      logger.error({ error }, 'Error registering name');
      return reply.status(500).send({
        success: false,
        error: 'Failed to register name',
        code: 'INTERNAL_ERROR',
      });
    }
  });

  /**
   * GET /ans/my-names
   * List all names registered by the authenticated user
   */
  fastify.get('/my-names', { preHandler: jwtAuthMiddleware }, async (request, reply) => {
    const telegramId = getAuthTelegramId(request);

    if (!telegramId) {
      return reply.status(401).send({
        success: false,
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    try {
      // Get user and wallet to retrieve partyId
      const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
      if (!user) {
        return reply.status(404).send({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
        });
      }

      const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);
      if (!wallet) {
        return reply.status(404).send({
          success: false,
          error: 'Wallet not found',
          code: 'WALLET_NOT_FOUND',
        });
      }

      // List entries using user's partyId
      const result = await ansService.listUserEntries(wallet.partyId);

      if (!result.success) {
        return reply.status(400).send({
          success: false,
          error: result.error,
          code: 'LIST_FAILED',
        });
      }

      const entries = result.entries ?? [];

      return {
        success: true,
        data: {
          entries: entries.map(entry => ({
            name: entry.name,
            baseName: ansService.getBaseName(entry.name),
            displayName: ansService.getDisplayName(ansService.getBaseName(entry.name)),
            contractId: entry.contractId,
            amount: entry.amount,
            unit: entry.unit,
            expiresAt: entry.expiresAt,
            paymentInterval: entry.paymentInterval,
            paymentDuration: entry.paymentDuration,
          })),
          count: entries.length,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Error listing user names');
      return reply.status(500).send({
        success: false,
        error: 'Failed to list names',
        code: 'INTERNAL_ERROR',
      });
    }
  });
};

export default ansRoutes;
