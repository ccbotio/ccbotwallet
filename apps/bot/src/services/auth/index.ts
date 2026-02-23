import { createHmac } from 'node:crypto';
import * as jose from 'jose';
import { eq } from 'drizzle-orm';
import { db, users, sessions } from '../../db/index.js';
import { env } from '../../config/env.js';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

// Redis key prefixes for token security
const USED_TOKEN_PREFIX = 'auth:used_token:';
const REVOKED_FAMILY_PREFIX = 'auth:revoked_family:';
// TTL for used tokens (7 days - matches refresh token expiry)
const USED_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const JWT_SECRET = new TextEncoder().encode(env.APP_SECRET.slice(0, 64));
const JWT_ISSUER = 'ccbot-wallet';
const JWT_AUDIENCE = 'ccbot-wallet-api';
const ACCESS_TOKEN_TTL = '15m';

export interface JWTPayload {
  sub: string; // userId
  telegramId: string;
  walletId?: string;
  sessionId: string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userId: string;
  isWhitelisted: boolean;
}

// Whitelist - comma-separated Telegram IDs in env, or empty for open access
function isUserWhitelisted(telegramId: string): boolean {
  const whitelist = env.WHITELIST_TELEGRAM_IDS;
  if (!whitelist || whitelist.trim() === '') {
    return true; // No whitelist = everyone allowed
  }
  const allowedIds = whitelist.split(',').map(id => id.trim());
  return allowedIds.includes(telegramId);
}

/**
 * Mark a refresh token as used in Redis.
 * This prevents replay attacks by tracking used tokens.
 */
async function markTokenAsUsed(token: string, userId: string): Promise<void> {
  const key = `${USED_TOKEN_PREFIX}${token}`;
  // Store userId with the token for family revocation
  await redis.setex(key, USED_TOKEN_TTL_SECONDS, userId);
}

/**
 * Check if a refresh token has already been used.
 * Returns the userId if used, null if not.
 */
async function getUsedTokenUserId(token: string): Promise<string | null> {
  const key = `${USED_TOKEN_PREFIX}${token}`;
  return redis.get(key);
}

/**
 * Revoke all tokens for a user (token family revocation).
 * This is triggered when a replay attack is detected.
 * Also exported for explicit logout functionality.
 */
export async function revokeUserTokenFamily(userId: string): Promise<void> {
  const key = `${REVOKED_FAMILY_PREFIX}${userId}`;
  // Set a flag that all tokens for this user are revoked
  // TTL matches refresh token expiry
  await redis.setex(key, USED_TOKEN_TTL_SECONDS, Date.now().toString());

  // Also delete all sessions for this user from the database
  await db.delete(sessions).where(eq(sessions.userId, userId));

  logger.warn({ userId }, 'Token family revoked - potential replay attack detected');
}

/**
 * Check if a user's token family has been revoked.
 */
async function isUserTokenFamilyRevoked(userId: string): Promise<boolean> {
  const key = `${REVOKED_FAMILY_PREFIX}${userId}`;
  const revoked = await redis.exists(key);
  return revoked === 1;
}

/**
 * Clear the token family revocation flag for a user (internal).
 */
async function clearUserTokenFamilyRevocationInternal(userId: string): Promise<void> {
  const key = `${REVOKED_FAMILY_PREFIX}${userId}`;
  await redis.del(key);
}

/**
 * Validate Telegram Mini App initData using HMAC-SHA256.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramInitData(initData: string): {
  valid: boolean;
  data: Record<string, string>;
} {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');

  if (!hash) {
    return { valid: false, data: {} };
  }

  // Remove hash from params and sort alphabetically
  params.delete('hash');
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  // HMAC chain: secret_key = HMAC-SHA256("WebAppData", bot_token)
  const secretKey = createHmac('sha256', 'WebAppData').update(env.TELEGRAM_BOT_TOKEN).digest();

  const computedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const valid = computedHash === hash;

  const data: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    data[key] = value;
  }

  return { valid, data };
}

/**
 * Authenticate a Telegram user and issue JWT tokens.
 */
export async function authenticateTelegram(initData: string): Promise<AuthResult> {
  let telegramId: string;
  let username: string | undefined;

  // Dev mode bypass - accept "dev_mode_TELEGRAM_ID" format
  if (env.NODE_ENV === 'development' && initData.startsWith('dev_mode_')) {
    telegramId = initData.replace('dev_mode_', '');
    username = 'dev_user';
  } else {
    const { valid, data } = validateTelegramInitData(initData);

    if (!valid) {
      throw new Error('Invalid Telegram initData');
    }

    const userData = JSON.parse(data.user ?? '{}') as {
      id?: number;
      username?: string;
      first_name?: string;
    };

    telegramId = userData.id?.toString() ?? '';
    username = userData.username;

    if (!telegramId) {
      throw new Error('No Telegram user ID in initData');
    }
  }

  // Find or create user
  let [user] = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);

  if (!user) {
    [user] = await db
      .insert(users)
      .values({
        telegramId,
        telegramUsername: username,
      })
      .returning();
  }

  if (!user) {
    throw new Error('Failed to create user');
  }

  // Clear any previous token family revocation (user is re-authenticating)
  await clearUserTokenFamilyRevocationInternal(user.id);

  // Create session
  const sessionId = crypto.randomUUID();
  const refreshTokenValue = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.insert(sessions).values({
    userId: user.id,
    telegramId,
    refreshToken: refreshTokenValue,
    expiresAt,
  });

  // Issue JWT
  const accessToken = await new jose.SignJWT({
    telegramId,
    sessionId,
  } satisfies Omit<JWTPayload, 'sub'>)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .setIssuedAt()
    .sign(JWT_SECRET);

  return {
    accessToken,
    refreshToken: refreshTokenValue,
    expiresIn: 900, // 15 minutes in seconds
    userId: user.id,
    isWhitelisted: isUserWhitelisted(telegramId),
  };
}

/**
 * Verify a JWT access token.
 */
export async function verifyAccessToken(token: string): Promise<JWTPayload> {
  const { payload } = await jose.jwtVerify(token, JWT_SECRET, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  const result: JWTPayload = {
    sub: payload.sub!,
    telegramId: payload.telegramId as string,
    sessionId: payload.sessionId as string,
  };
  if (payload.walletId) result.walletId = payload.walletId as string;
  return result;
}

/**
 * Refresh an access token using a refresh token.
 *
 * SECURITY: Implements OAuth 2.0 refresh token rotation to prevent replay attacks.
 * - Each refresh token can only be used ONCE
 * - A new refresh token is issued with each refresh
 * - If a used token is presented again, ALL tokens for that user are revoked
 *   (this indicates the token was stolen and both attacker and legitimate user have it)
 */
export async function refreshAccessToken(refreshToken: string): Promise<AuthResult> {
  // Step 1: Check if this token was already used (replay attack detection)
  const usedByUserId = await getUsedTokenUserId(refreshToken);
  if (usedByUserId) {
    // SECURITY: Token replay detected!
    // Revoke ALL tokens for this user (token family revocation)
    logger.warn(
      { userId: usedByUserId, tokenPrefix: refreshToken.slice(0, 8) },
      'Refresh token replay attack detected - revoking all user tokens'
    );
    await revokeUserTokenFamily(usedByUserId);
    throw new Error('Token has been revoked due to suspected compromise');
  }

  // Step 2: Look up the session by refresh token
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.refreshToken, refreshToken))
    .limit(1);

  if (!session || session.expiresAt < new Date()) {
    throw new Error('Invalid or expired refresh token');
  }

  // Step 3: Check if user's token family has been revoked
  if (await isUserTokenFamilyRevoked(session.userId)) {
    throw new Error('All sessions have been revoked - please re-authenticate');
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);

  if (!user) {
    throw new Error('User not found');
  }

  // Step 4: Mark the current token as used BEFORE issuing new tokens
  // This ensures if the operation fails after this point, the old token is still invalidated
  await markTokenAsUsed(refreshToken, session.userId);

  // Step 5: Generate new refresh token (rotation)
  const newRefreshToken = crypto.randomUUID();
  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // Step 6: Update the session with the new refresh token
  await db
    .update(sessions)
    .set({
      refreshToken: newRefreshToken,
      expiresAt: newExpiresAt,
    })
    .where(eq(sessions.id, session.id));

  // Step 7: Issue new access token
  const sessionId = crypto.randomUUID();

  const accessToken = await new jose.SignJWT({
    telegramId: session.telegramId,
    sessionId,
  } satisfies Omit<JWTPayload, 'sub'>)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .setIssuedAt()
    .sign(JWT_SECRET);

  logger.debug(
    { userId: user.id, tokenPrefix: newRefreshToken.slice(0, 8) },
    'Refresh token rotated successfully'
  );

  return {
    accessToken,
    refreshToken: newRefreshToken, // Return NEW refresh token
    expiresIn: 900,
    userId: user.id,
    isWhitelisted: isUserWhitelisted(session.telegramId),
  };
}

/**
 * Revoke a specific refresh token (logout).
 * Marks the token as used so it cannot be replayed.
 */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.refreshToken, refreshToken))
    .limit(1);

  if (session) {
    // Mark token as used
    await markTokenAsUsed(refreshToken, session.userId);
    // Delete the session
    await db.delete(sessions).where(eq(sessions.id, session.id));
    logger.info({ userId: session.userId }, 'Refresh token revoked (logout)');
  }
}

/**
 * Clear the token family revocation flag for a user.
 * Call this after the user successfully re-authenticates.
 */
export async function clearUserTokenFamilyRevocation(userId: string): Promise<void> {
  await clearUserTokenFamilyRevocationInternal(userId);
}
