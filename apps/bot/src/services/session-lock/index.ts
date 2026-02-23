import { eq } from 'drizzle-orm';
import { db, sessionLocks, users } from '../../db/index.js';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

// Redis key prefixes for session lock caching
const SESSION_LOCK_PREFIX = 'session:lock:';
const SESSION_ACTIVITY_PREFIX = 'session:activity:';
// Cache TTL in seconds (1 minute)
const CACHE_TTL = 60;

// Default lock timeout in seconds (5 minutes)
const DEFAULT_LOCK_TIMEOUT = 300;

// Minimum and maximum lock timeout values
const MIN_LOCK_TIMEOUT = 60; // 1 minute
const MAX_LOCK_TIMEOUT = 3600; // 1 hour

export interface LockStatus {
  isLocked: boolean;
  lastActivityAt: Date;
  lockTimeoutSeconds: number;
}

export class SessionLockService {
  /**
   * Update last activity timestamp (heartbeat).
   * Called periodically by the client to keep the session alive.
   */
  async heartbeat(userId: string): Promise<void> {
    const now = new Date();

    // Update in database
    const [existing] = await db
      .select()
      .from(sessionLocks)
      .where(eq(sessionLocks.userId, userId))
      .limit(1);

    if (existing) {
      // Only update if not locked
      if (!existing.isLocked) {
        await db
          .update(sessionLocks)
          .set({
            lastActivityAt: now,
            updatedAt: now,
          })
          .where(eq(sessionLocks.userId, userId));

        // Update cache
        await redis.setex(
          `${SESSION_ACTIVITY_PREFIX}${userId}`,
          CACHE_TTL,
          now.toISOString()
        );

        logger.debug({ userId }, 'Session heartbeat updated');
      }
    } else {
      // Create new session lock record
      await db.insert(sessionLocks).values({
        userId,
        isLocked: false,
        lastActivityAt: now,
        lockTimeoutSeconds: DEFAULT_LOCK_TIMEOUT,
      });

      // Cache the activity
      await redis.setex(
        `${SESSION_ACTIVITY_PREFIX}${userId}`,
        CACHE_TTL,
        now.toISOString()
      );

      logger.info({ userId }, 'Session lock record created');
    }
  }

  /**
   * Check if session should be locked based on last activity.
   * Automatically locks session if timeout has been exceeded.
   */
  async checkLockStatus(userId: string): Promise<LockStatus> {
    // Try to get from cache first
    const cachedLock = await redis.get(`${SESSION_LOCK_PREFIX}${userId}`);

    if (cachedLock === 'locked') {
      // Get last activity from DB for full status
      const [record] = await db
        .select()
        .from(sessionLocks)
        .where(eq(sessionLocks.userId, userId))
        .limit(1);

      return {
        isLocked: true,
        lastActivityAt: record?.lastActivityAt ?? new Date(),
        lockTimeoutSeconds: record?.lockTimeoutSeconds ?? DEFAULT_LOCK_TIMEOUT,
      };
    }

    // Get from database
    const [record] = await db
      .select()
      .from(sessionLocks)
      .where(eq(sessionLocks.userId, userId))
      .limit(1);

    if (!record) {
      // No session lock record exists - session is unlocked
      return {
        isLocked: false,
        lastActivityAt: new Date(),
        lockTimeoutSeconds: DEFAULT_LOCK_TIMEOUT,
      };
    }

    // If already locked, return locked status
    if (record.isLocked) {
      // Cache the locked status
      await redis.setex(`${SESSION_LOCK_PREFIX}${userId}`, CACHE_TTL, 'locked');

      return {
        isLocked: true,
        lastActivityAt: record.lastActivityAt,
        lockTimeoutSeconds: record.lockTimeoutSeconds,
      };
    }

    // Check if timeout has been exceeded
    const now = Date.now();
    const lastActivity = record.lastActivityAt.getTime();
    const timeoutMs = record.lockTimeoutSeconds * 1000;

    if (now - lastActivity > timeoutMs) {
      // Auto-lock the session
      await this.lock(userId);

      logger.info(
        { userId, lastActivity: record.lastActivityAt, timeout: record.lockTimeoutSeconds },
        'Session auto-locked due to inactivity'
      );

      return {
        isLocked: true,
        lastActivityAt: record.lastActivityAt,
        lockTimeoutSeconds: record.lockTimeoutSeconds,
      };
    }

    // Session is active
    return {
      isLocked: false,
      lastActivityAt: record.lastActivityAt,
      lockTimeoutSeconds: record.lockTimeoutSeconds,
    };
  }

  /**
   * Lock the session immediately.
   */
  async lock(userId: string): Promise<void> {
    const now = new Date();

    const [existing] = await db
      .select()
      .from(sessionLocks)
      .where(eq(sessionLocks.userId, userId))
      .limit(1);

    if (existing) {
      await db
        .update(sessionLocks)
        .set({
          isLocked: true,
          updatedAt: now,
        })
        .where(eq(sessionLocks.userId, userId));
    } else {
      // Create locked session
      await db.insert(sessionLocks).values({
        userId,
        isLocked: true,
        lastActivityAt: now,
        lockTimeoutSeconds: DEFAULT_LOCK_TIMEOUT,
      });
    }

    // Update cache
    await redis.setex(`${SESSION_LOCK_PREFIX}${userId}`, CACHE_TTL, 'locked');

    logger.info({ userId }, 'Session locked');
  }

  /**
   * Unlock the session.
   * NOTE: PIN verification should be done by the caller before calling this method.
   * The caller is responsible for verifying the PIN using the existing PIN/share mechanism.
   */
  async unlock(userId: string): Promise<void> {
    const now = new Date();

    await db
      .update(sessionLocks)
      .set({
        isLocked: false,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(sessionLocks.userId, userId));

    // Clear the locked cache
    await redis.del(`${SESSION_LOCK_PREFIX}${userId}`);

    // Update activity cache
    await redis.setex(
      `${SESSION_ACTIVITY_PREFIX}${userId}`,
      CACHE_TTL,
      now.toISOString()
    );

    logger.info({ userId }, 'Session unlocked');
  }

  /**
   * Get the lock timeout setting for a user.
   */
  async getLockTimeout(userId: string): Promise<number> {
    const [record] = await db
      .select()
      .from(sessionLocks)
      .where(eq(sessionLocks.userId, userId))
      .limit(1);

    return record?.lockTimeoutSeconds ?? DEFAULT_LOCK_TIMEOUT;
  }

  /**
   * Set the lock timeout for a user.
   * @param userId - User ID
   * @param seconds - Timeout in seconds (min: 60, max: 3600)
   */
  async setLockTimeout(userId: string, seconds: number): Promise<void> {
    // Validate timeout range
    const validatedTimeout = Math.max(
      MIN_LOCK_TIMEOUT,
      Math.min(MAX_LOCK_TIMEOUT, seconds)
    );

    const now = new Date();

    const [existing] = await db
      .select()
      .from(sessionLocks)
      .where(eq(sessionLocks.userId, userId))
      .limit(1);

    if (existing) {
      await db
        .update(sessionLocks)
        .set({
          lockTimeoutSeconds: validatedTimeout,
          updatedAt: now,
        })
        .where(eq(sessionLocks.userId, userId));
    } else {
      await db.insert(sessionLocks).values({
        userId,
        isLocked: false,
        lastActivityAt: now,
        lockTimeoutSeconds: validatedTimeout,
      });
    }

    logger.info({ userId, timeout: validatedTimeout }, 'Lock timeout updated');
  }

  /**
   * Get user ID from telegram ID.
   * Helper method for route handlers.
   */
  async getUserIdFromTelegramId(telegramId: string): Promise<string | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);

    return user?.id ?? null;
  }

  /**
   * Initialize session lock for a new user.
   * Called during wallet creation or first login.
   */
  async initializeForUser(userId: string): Promise<void> {
    const [existing] = await db
      .select()
      .from(sessionLocks)
      .where(eq(sessionLocks.userId, userId))
      .limit(1);

    if (!existing) {
      await db.insert(sessionLocks).values({
        userId,
        isLocked: false,
        lastActivityAt: new Date(),
        lockTimeoutSeconds: DEFAULT_LOCK_TIMEOUT,
      });

      logger.info({ userId }, 'Session lock initialized for user');
    }
  }
}

// Singleton instance
export const sessionLockService = new SessionLockService();
