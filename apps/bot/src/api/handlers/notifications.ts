import type { FastifyRequest, FastifyReply } from 'fastify';
import { eq, desc, and } from 'drizzle-orm';
import { z } from 'zod';
import { db, users, notifications } from '../../db/index.js';
import { getAuthTelegramId, getAuthUserId } from '../middleware/jwt-auth.js';

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(20),
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

const markReadParamsSchema = z.object({
  id: z.string().uuid(),
});

export const notificationHandlers = {
  /**
   * GET /notifications
   * List notifications for the authenticated user.
   */
  async list(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);
    const userId = getAuthUserId(request);

    if (!telegramId && !userId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    // Find user
    let actualUserId = userId;
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

    const query = listQuerySchema.parse(request.query ?? {});
    const offset = (query.page - 1) * query.pageSize;

    // Build query conditions
    const conditions = [eq(notifications.userId, actualUserId)];
    if (query.unreadOnly) {
      conditions.push(eq(notifications.read, false));
    }

    // Get notifications with pagination
    const notificationsList = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(query.pageSize)
      .offset(offset);

    // Get total count for pagination
    const countResult = await db
      .select()
      .from(notifications)
      .where(and(...conditions));
    const total = countResult.length;

    // Get unread count
    const unreadResult = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, actualUserId), eq(notifications.read, false)));
    const unreadCount = unreadResult.length;

    return reply.send({
      success: true,
      data: {
        notifications: notificationsList.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          data: n.data,
          read: n.read,
          createdAt: n.createdAt.toISOString(),
        })),
        total,
        unreadCount,
        page: query.page,
        pageSize: query.pageSize,
        hasMore: offset + notificationsList.length < total,
      },
    });
  },

  /**
   * POST /notifications/:id/read
   * Mark a single notification as read.
   */
  async markAsRead(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);
    const userId = getAuthUserId(request);

    if (!telegramId && !userId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    // Find user
    let actualUserId = userId;
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

    const params = markReadParamsSchema.parse(request.params);

    // Update notification if it belongs to the user
    const [notification] = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, params.id), eq(notifications.userId, actualUserId)))
      .limit(1);

    if (!notification) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOTIFICATION_NOT_FOUND', message: 'Notification not found' },
      });
    }

    await db.update(notifications).set({ read: true }).where(eq(notifications.id, params.id));

    return reply.send({
      success: true,
      data: { message: 'Notification marked as read' },
    });
  },

  /**
   * POST /notifications/read-all
   * Mark all notifications as read for the authenticated user.
   */
  async markAllAsRead(request: FastifyRequest, reply: FastifyReply) {
    const telegramId = getAuthTelegramId(request);
    const userId = getAuthUserId(request);

    if (!telegramId && !userId) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing authentication' },
      });
    }

    // Find user
    let actualUserId = userId;
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

    // Update all unread notifications for this user
    await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.userId, actualUserId), eq(notifications.read, false)));

    return reply.send({
      success: true,
      data: { message: 'All notifications marked as read' },
    });
  },
};
