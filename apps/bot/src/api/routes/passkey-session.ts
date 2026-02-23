import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { passkeySessionService } from '../../services/passkey-session/index.js';
import { passkeyService } from '../../services/passkey/index.js';
import { jwtAuthMiddleware, getAuthTelegramId } from '../middleware/jwt-auth.js';
import { db } from '../../db/index.js';
import { wallets, users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export async function passkeySessionRoutes(fastify: FastifyInstance) {
  /**
   * POST /passkey-session/create
   * Creates a new passkey session for OAuth+PKCE flow
   * Called by Mini App (authenticated)
   */
  fastify.post('/create', { preHandler: jwtAuthMiddleware }, async (request, reply) => {
    const telegramId = getAuthTelegramId(request);
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const bodySchema = z.object({
      walletId: z.string().uuid(),
      partyId: z.string(),
      userShareHex: z.string(),
      codeChallenge: z.string(), // SHA256 hash of code_verifier (base64url)
      displayName: z.string().optional(),
    });

    const body = bodySchema.parse(request.body);

    // Verify wallet belongs to this user
    const [wallet] = await db
      .select()
      .from(wallets)
      .innerJoin(users, eq(wallets.userId, users.id))
      .where(eq(wallets.id, body.walletId))
      .limit(1);

    if (!wallet || wallet.users.telegramId !== telegramId) {
      return reply.status(403).send({ error: 'Wallet not found or access denied' });
    }

    // SECURITY: Require verified email before creating passkey session
    if (!wallet.users.email) {
      return reply.status(400).send({
        error: 'Email verification required before creating passkey session',
        code: 'EMAIL_REQUIRED',
      });
    }

    // Get client info for audit
    const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? request.headers['x-real-ip'] as string
      ?? request.ip;

    // Create session
    const { sessionId, expiresAt } = await passkeySessionService.createSession({
      userId: wallet.users.id,
      telegramId,
      walletId: body.walletId,
      partyId: body.partyId,
      email: wallet.users.email, // SECURITY: Bind session to verified email
      userShareHex: body.userShareHex,
      codeChallenge: body.codeChallenge,
      ipAddress: clientIp,
      userAgent: request.headers['user-agent'] as string,
      ...(body.displayName && { displayName: body.displayName }),
    });

    return reply.send({
      sessionId,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    });
  });

  /**
   * GET /passkey-session/:sessionId
   * Get session data for external browser (NO AUTH - session ID is the auth)
   * Called by Safari
   *
   * SECURITY: userShareHex is NEVER returned in API responses.
   * The share is stored server-side and used only during the /complete call.
   */
  fastify.get('/:sessionId', async (request, reply) => {
    const paramsSchema = z.object({
      sessionId: z.string(),
    });

    const { sessionId } = paramsSchema.parse(request.params);

    const session = await passkeySessionService.getSessionForAuth(sessionId);

    if (!session) {
      return reply.status(404).send({
        error: 'Session not found or expired',
        code: 'SESSION_NOT_FOUND',
      });
    }

    // Generate WebAuthn challenge
    const challenge = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

    // SECURITY FIX: Never return userShareHex in API response
    // The share is kept server-side and used only during passkey registration
    return reply.send({
      walletId: session.walletId,
      partyId: session.partyId,
      displayName: session.displayName,
      challenge,
    });
  });

  /**
   * POST /passkey-session/:sessionId/complete
   * Mark session as completed after passkey registration
   * Called by Safari
   *
   * SECURITY:
   * 1. Requires PKCE code_verifier to prove the caller owns the session
   * 2. Uses verifyPkceAndComplete for atomic PKCE verification + session completion
   * 3. userShareHex is used server-side only and NEVER returned in the response
   */
  fastify.post('/:sessionId/complete', async (request, reply) => {
    const paramsSchema = z.object({
      sessionId: z.string(),
    });

    const bodySchema = z.object({
      credentialId: z.string(),
      publicKeySpki: z.string(),
      encryptedShare: z.string(),
      nonce: z.string(),
      deviceName: z.string().optional(),
      codeVerifier: z.string().min(43).max(128), // PKCE code_verifier (RFC 7636: 43-128 chars)
    });

    const { sessionId } = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);

    // SECURITY: Atomic PKCE verification + session completion
    // This returns session data (including userShareHex) ONLY if PKCE succeeds
    const result = await passkeySessionService.verifyPkceAndComplete(
      sessionId,
      body.credentialId,
      body.codeVerifier
    );

    if (!result.success || !result.session) {
      return reply.status(403).send({
        error: result.error || 'Session completion failed',
        code: 'PKCE_VERIFICATION_FAILED',
      });
    }

    // PKCE verified - register the passkey credential using the server-side share
    // SECURITY: userShareHex is used here but NEVER returned in the response
    await passkeyService.registerPasskey(
      result.session.userId,
      result.session.walletId,
      result.session.email, // SECURITY: Bind passkey to email at session creation
      body.credentialId,
      body.publicKeySpki,
      body.encryptedShare,
      body.nonce,
      result.session.userShareHex, // Server-side only, never in response
      body.deviceName || 'Unknown Device'
    );

    // SECURITY: Response contains NO sensitive data
    return reply.send({
      success: true,
      message: 'Passkey registered successfully',
    });
  });

  /**
   * POST /passkey-session/:sessionId/status
   * Check session status with PKCE verification
   * Called by Mini App (authenticated)
   */
  fastify.post('/:sessionId/status', { preHandler: jwtAuthMiddleware }, async (request, reply) => {
    const telegramId = getAuthTelegramId(request);
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const paramsSchema = z.object({
      sessionId: z.string(),
    });

    const bodySchema = z.object({
      codeVerifier: z.string(), // Original code_verifier for PKCE verification
    });

    const { sessionId } = paramsSchema.parse(request.params);
    const { codeVerifier } = bodySchema.parse(request.body);

    const result = await passkeySessionService.checkSessionStatus(sessionId, codeVerifier);

    return reply.send(result);
  });

  // ==================== PASSKEY-ONLY FLOW (NEW) ====================
  // These endpoints support creating passkey BEFORE wallet creation

  /**
   * POST /passkey-session/create-only
   * Creates a passkey-only session (no wallet data)
   * Called by Mini App (authenticated)
   * SECURITY: Requires verified email before creating passkey session
   */
  fastify.post('/create-only', { preHandler: jwtAuthMiddleware }, async (request, reply) => {
    const telegramId = getAuthTelegramId(request);
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const bodySchema = z.object({
      codeChallenge: z.string(),
      displayName: z.string().optional(),
    });

    const body = bodySchema.parse(request.body);

    // Get user to verify email
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .limit(1);

    if (!user) {
      return reply.status(404).send({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    // SECURITY: Require verified email before creating passkey session
    if (!user.email) {
      return reply.status(400).send({
        error: 'Email verification required before creating passkey session',
        code: 'EMAIL_REQUIRED',
      });
    }

    // Get client info for audit
    const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      ?? request.headers['x-real-ip'] as string
      ?? request.ip;

    // Create passkey-only session
    const { sessionId, expiresAt } = await passkeySessionService.createPasskeyOnlySession({
      userId: user.id,
      telegramId,
      email: user.email, // SECURITY: Bind session to verified email
      codeChallenge: body.codeChallenge,
      ipAddress: clientIp,
      userAgent: request.headers['user-agent'] as string,
      ...(body.displayName && { displayName: body.displayName }),
    });

    return reply.send({
      sessionId,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
    });
  });

  /**
   * GET /passkey-session/:sessionId/only
   * Get passkey-only session data for external browser (NO AUTH)
   * Called by Safari
   */
  fastify.get('/:sessionId/only', async (request, reply) => {
    const paramsSchema = z.object({
      sessionId: z.string(),
    });

    const { sessionId } = paramsSchema.parse(request.params);

    const session = await passkeySessionService.getPasskeyOnlySession(sessionId);

    if (!session) {
      return reply.status(404).send({
        error: 'Session not found or expired',
        code: 'SESSION_NOT_FOUND',
      });
    }

    // Generate WebAuthn challenge
    const challenge = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

    return reply.send({
      displayName: session.displayName,
      challenge,
    });
  });

  /**
   * POST /passkey-session/:sessionId/complete-only
   * Complete passkey-only registration (no wallet involvement)
   * Called by Safari
   */
  fastify.post('/:sessionId/complete-only', async (request, reply) => {
    const paramsSchema = z.object({
      sessionId: z.string(),
    });

    const bodySchema = z.object({
      credentialId: z.string(),
      publicKeySpki: z.string(),
      deviceName: z.string().optional(),
      codeVerifier: z.string().min(43).max(128),
    });

    const { sessionId } = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);

    // Verify PKCE and complete the session
    const result = await passkeySessionService.completePasskeyOnlySession(
      sessionId,
      body.credentialId,
      body.publicKeySpki,
      body.codeVerifier,
      body.deviceName
    );

    if (!result.success) {
      return reply.status(403).send({
        error: result.error || 'Session completion failed',
        code: 'PKCE_VERIFICATION_FAILED',
      });
    }

    return reply.send({
      success: true,
      message: 'Passkey registered successfully',
    });
  });

  /**
   * POST /passkey-session/:sessionId/status-only
   * Check passkey-only session status with PKCE verification
   * Called by Mini App (authenticated)
   */
  fastify.post('/:sessionId/status-only', { preHandler: jwtAuthMiddleware }, async (request, reply) => {
    const telegramId = getAuthTelegramId(request);
    if (!telegramId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const paramsSchema = z.object({
      sessionId: z.string(),
    });

    const bodySchema = z.object({
      codeVerifier: z.string(),
    });

    const { sessionId } = paramsSchema.parse(request.params);
    const { codeVerifier } = bodySchema.parse(request.body);

    const result = await passkeySessionService.checkPasskeyOnlySessionStatus(sessionId, codeVerifier);

    return reply.send(result);
  });
}
