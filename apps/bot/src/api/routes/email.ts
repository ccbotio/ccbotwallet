import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { emailService } from '../../services/email/index.js';
import { getAuthUserId, getAuthTelegramId, jwtAuthMiddleware } from '../middleware/jwt-auth.js';
import { db, users, wallets, passkeyCredentials } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import { queueNotification } from '../../jobs/index.js';
import { logger } from '../../lib/logger.js';

const sendCodeSchema = z.object({
  email: z.string().email('Invalid email format'),
});

const verifyCodeSchema = z.object({
  email: z.string().email('Invalid email format'),
  code: z.string().length(6, 'Code must be 6 digits'),
});

const checkEmailSchema = z.object({
  email: z.string().email('Invalid email format'),
});

export function emailRoutes(fastify: FastifyInstance): void {
  // Apply JWT auth middleware to all email routes
  fastify.addHook('preHandler', jwtAuthMiddleware);

  /**
   * POST /api/email/check
   * Check if email already has a wallet (for determining create vs recover flow)
   */
  fastify.post('/check', async (request, reply) => {
    const body = checkEmailSchema.parse(request.body);
    const emailLower = body.email.toLowerCase();

    // Check if any user has this email and has a wallet with passkey
    const existingUser = await db
      .select({
        userId: users.id,
        walletId: wallets.id,
        partyId: wallets.partyId,
      })
      .from(users)
      .innerJoin(wallets, eq(wallets.userId, users.id))
      .where(eq(users.email, emailLower))
      .limit(1);

    const foundUser = existingUser[0];
    if (foundUser) {
      // Check if wallet has passkey credentials
      const hasPasskey = await db
        .select({ id: passkeyCredentials.id })
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.walletId, foundUser.walletId))
        .limit(1);

      return reply.send({
        success: true,
        data: {
          exists: true,
          hasWallet: true,
          hasPasskey: hasPasskey.length > 0,
          partyId: foundUser.partyId,
        },
      });
    }

    return reply.send({
      success: true,
      data: {
        exists: false,
        hasWallet: false,
        hasPasskey: false,
      },
    });
  });
  /**
   * POST /api/email/send-code
   * Send a verification code to the specified email
   */
  fastify.post('/send-code', async (request, reply) => {
    const userId = getAuthUserId(request);
    const telegramId = getAuthTelegramId(request);

    if (!userId && !telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
    }

    let actualUserId: string | null = userId ?? null;
    if (!actualUserId && telegramId) {
      const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
      actualUserId = user?.id ?? null;
    }

    if (!actualUserId) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    const body = sendCodeSchema.parse(request.body);
    const emailLower = body.email.toLowerCase();

    // Get client IP for rate limiting
    const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? request.headers['x-real-ip'] as string
      ?? request.ip;

    // Check if email is used by ANY other user
    const emailUsedByOther = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, emailLower))
      .limit(1);

    const existingEmailOwner = emailUsedByOther[0];
    if (existingEmailOwner && existingEmailOwner.id !== actualUserId) {
      return reply.status(409).send({
        success: false,
        error: {
          code: 'EMAIL_TAKEN',
          message: 'This email is already associated with another wallet. Please use the recovery option.'
        },
      });
    }

    // SECURITY: Pass IP address for rate limiting
    const result = await emailService.sendCode(actualUserId, body.email, clientIp);

    if (!result.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'SEND_FAILED', message: result.message },
      });
    }

    return reply.send({
      success: true,
      data: {
        message: result.message,
        expiresAt: result.expiresAt,
      },
    });
  });

  /**
   * POST /api/email/verify
   * Verify the code entered by the user
   */
  fastify.post('/verify', async (request, reply) => {
    const userId = getAuthUserId(request);
    const telegramId = getAuthTelegramId(request);

    if (!userId && !telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
    }

    let actualUserId: string | null = userId ?? null;
    let actualTelegramId: string | null = telegramId ?? null;

    if (!actualUserId && telegramId) {
      const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
      actualUserId = user?.id ?? null;
    }

    if (!actualUserId) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    // Get telegramId if we only have userId
    if (!actualTelegramId) {
      const [user] = await db
        .select({ telegramId: users.telegramId })
        .from(users)
        .where(eq(users.id, actualUserId))
        .limit(1);
      actualTelegramId = user?.telegramId ?? null;
    }

    const body = verifyCodeSchema.parse(request.body);

    // Get client IP for audit logging
    const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? request.headers['x-real-ip'] as string
      ?? request.ip;

    // SECURITY: Pass IP address for audit logging
    const result = await emailService.verifyCode(actualUserId, body.email, body.code, clientIp);

    if (!result.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VERIFY_FAILED', message: result.message },
      });
    }

    // Note: Email and emailVerifiedAt are already updated in emailService.verifyCode()

    // Queue notification for email verified
    if (actualTelegramId) {
      try {
        await queueNotification({
          type: 'email_verified',
          telegramId: actualTelegramId,
          data: { verifiedEmail: body.email.toLowerCase() },
        });
      } catch (notifyError) {
        logger.error({ err: notifyError }, 'Failed to queue email verified notification');
      }
    }

    return reply.send({
      success: true,
      data: { message: result.message },
    });
  });

  /**
   * GET /api/email/status
   * Check if user has verified email
   */
  fastify.get('/status', async (request, reply) => {
    const userId = getAuthUserId(request);
    const telegramId = getAuthTelegramId(request);

    if (!userId && !telegramId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
    }

    let actualUserId: string | null = userId ?? null;
    if (!actualUserId && telegramId) {
      const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
      actualUserId = user?.id ?? null;
    }

    if (!actualUserId) {
      return reply.status(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      });
    }

    const isVerified = await emailService.isEmailVerified(actualUserId);

    return reply.send({
      success: true,
      data: { isVerified },
    });
  });
}
