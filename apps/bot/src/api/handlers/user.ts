import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, users, wallets } from '../../db/index.js';
import { verificationService } from '../../services/verification/index.js';
import { verificationRequestSchema } from '@repo/shared/validation';

export const userHandlers = {
  async getProfile(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = request.headers['x-telegram-id'] as string;

    if (!telegramId) {
      return reply
        .status(401)
        .send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing telegram ID' } });
    }

    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);

    if (!user) {
      return reply
        .status(404)
        .send({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }

    const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);

    return reply.send({
      success: true,
      data: {
        id: user.id,
        telegramId: user.telegramId,
        telegramUsername: user.telegramUsername,
        tier: user.tier,
        isVerified: user.isVerified,
        streakCount: user.streakCount,
        wallet: wallet ? { partyId: wallet.partyId } : null,
      },
    });
  },

  async verify(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = request.headers['x-telegram-id'] as string;

    if (!telegramId) {
      return reply
        .status(401)
        .send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing telegram ID' } });
    }

    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);

    if (!user) {
      return reply
        .status(404)
        .send({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }

    const body = verificationRequestSchema.parse(request.body);
    const verification = await verificationService.createVerification(user.id, body.type);

    return reply.send({ success: true, data: verification });
  },
};
