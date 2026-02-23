import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { users, wallets } from '../../db/schema.js';
import { eq, like } from 'drizzle-orm';
import { validateUsername, normalizeUsername } from '../../utils/username.js';
import { jwtAuthMiddleware, getAuthTelegramId, getAuthUserId } from '../middleware/jwt-auth.js';

const setUsernameSchema = z.object({
  username: z.string().min(3).max(15),
});

export async function usernameRoutes(fastify: FastifyInstance) {
  // Apply JWT auth middleware only to /set endpoint (others are public)
  fastify.addHook('preHandler', async (request, reply) => {
    // Only apply JWT auth to POST /set
    if (request.method === 'POST' && request.url.endsWith('/set')) {
      await jwtAuthMiddleware(request, reply);
    }
  });
  /**
   * Check if username is available
   * GET /api/username/check/:username
   */
  fastify.get<{ Params: { username: string } }>('/check/:username', async (request, reply) => {
    const { username } = request.params;
    const normalized = normalizeUsername(username);

    // Validate format
    const validation = validateUsername(normalized);
    if (!validation.valid) {
      return reply.send({
        success: true,
        data: { available: false, reason: validation.error },
      });
    }

    // Check if taken
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, normalized))
      .limit(1);

    const available = existing.length === 0;

    return reply.send({
      success: true,
      data: {
        available,
        reason: available ? undefined : 'Username is already taken',
      },
    });
  });

  /**
   * Set username for authenticated user
   * POST /api/username/set
   */
  fastify.post<{ Body: z.infer<typeof setUsernameSchema> }>('/set', async (request, reply) => {
    // Support both JWT auth (userId from token) and legacy x-telegram-id header
    let userId = getAuthUserId(request);

    if (!userId) {
      // Fallback: look up user by telegram ID from header
      const telegramId = getAuthTelegramId(request);
      if (telegramId) {
        const [userByTg] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.telegramId, telegramId))
          .limit(1);
        userId = userByTg?.id ?? null;
      }
    }

    if (!userId) {
      return reply.status(401).send({ success: false, error: 'Unauthorized' });
    }

    const { username } = setUsernameSchema.parse(request.body);
    const normalized = normalizeUsername(username);

    // Validate format
    const validation = validateUsername(normalized);
    if (!validation.valid) {
      return reply.status(400).send({
        success: false,
        error: validation.error,
      });
    }

    // Get current user
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    if (!user) {
      return reply.status(404).send({ success: false, error: 'User not found' });
    }

    // Username is immutable - cannot be changed once set (like ANS on mainnet)
    if (user.username) {
      return reply.status(400).send({
        success: false,
        error: 'Username cannot be changed once set',
      });
    }

    // Check if username is taken
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, normalized))
      .limit(1);

    if (existing.length > 0) {
      return reply.status(409).send({
        success: false,
        error: 'Username is already taken',
      });
    }

    // Set username (immutable - recorded permanently)
    await db
      .update(users)
      .set({
        username: normalized,
        usernameChangedAt: new Date(), // Records when username was set
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    return reply.send({
      success: true,
      data: {
        username: normalized,
        permanent: true, // Username is immutable like ANS
      },
    });
  });

  /**
   * Resolve username to party ID
   * GET /api/username/resolve/:username
   */
  fastify.get<{ Params: { username: string } }>('/resolve/:username', async (request, reply) => {
    const { username } = request.params;
    const normalized = normalizeUsername(username);

    // Find user by username
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        cantonPartyId: users.cantonPartyId,
      })
      .from(users)
      .where(eq(users.username, normalized))
      .limit(1);

    if (!user) {
      return reply.status(404).send({
        success: false,
        error: 'Username not found',
      });
    }

    // Get wallet party ID if not on user
    let partyId: string | null = user.cantonPartyId;
    if (!partyId) {
      const [wallet] = await db
        .select({ partyId: wallets.partyId })
        .from(wallets)
        .where(eq(wallets.userId, user.id))
        .limit(1);
      partyId = wallet?.partyId ?? null;
    }

    if (!partyId) {
      return reply.status(404).send({
        success: false,
        error: 'User has no wallet',
      });
    }

    return reply.send({
      success: true,
      data: {
        username: user.username,
        partyId,
      },
    });
  });

  /**
   * Search usernames by prefix
   * GET /api/username/search?q=xxx&limit=10
   */
  fastify.get<{ Querystring: { q?: string; limit?: string } }>(
    '/search',
    async (request, reply) => {
      const { q, limit = '10' } = request.query;
      const searchLimit = Math.min(parseInt(limit, 10) || 10, 20);

      if (!q || q.length < 1) {
        return reply.send({ success: true, data: { users: [] } });
      }

      const normalized = normalizeUsername(q);

      // Search with prefix match using Drizzle
      const results = await db
        .select({
          username: users.username,
          cantonPartyId: users.cantonPartyId,
          oddsPartyId: wallets.partyId,
        })
        .from(users)
        .leftJoin(wallets, eq(wallets.userId, users.id))
        .where(like(users.username, `${normalized}%`))
        .limit(searchLimit);

      const filtered = results
        .filter((r) => r.username && (r.cantonPartyId || r.oddsPartyId))
        .map((r) => ({
          username: r.username!,
          partyId: r.cantonPartyId || r.oddsPartyId!,
        }));

      return reply.send({
        success: true,
        data: { users: filtered },
      });
    }
  );
}
