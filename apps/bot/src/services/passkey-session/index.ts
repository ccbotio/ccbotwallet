import { eq, and, gt, lt, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { passkeySessions } from '../../db/schema.js';
import { randomBytes, createHash } from 'crypto';
import { createLogger } from '@repo/shared/logger';

const logger = createLogger('passkey-session');

// Helper to check if drizzle update/delete affected rows
// Different drivers return different properties (rowCount, changes, count)
function getAffectedRows(result: unknown): number {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.rowCount === 'number') return r.rowCount;
    if (typeof r.changes === 'number') return r.changes;
    if (typeof r.count === 'number') return r.count;
  }
  return 0;
}

const SESSION_EXPIRY_MINUTES = 24 * 60; // 24 hours (dev mode)

export interface CreateSessionParams {
  userId: string;
  telegramId: string;
  walletId: string;
  partyId: string;
  email: string; // User's verified email at session creation
  userShareHex: string;
  codeChallenge: string;
  displayName?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Session data returned for external browser (Safari).
 * SECURITY: userShareHex is intentionally excluded - never expose shares in API responses.
 */
export interface SessionData {
  sessionId: string;
  walletId: string | null;  // Nullable for passkey-only flow
  partyId: string | null;   // Nullable for passkey-only flow
  displayName: string;
  status: string;
}

/**
 * Internal session data including the encrypted share (for server-side use only).
 * This is NEVER returned in API responses.
 */
export interface InternalSessionData extends SessionData {
  userId: string;
  email: string; // Email at session creation
  userShareHex: string | null; // Nullable for passkey-only flow
}

export class PasskeySessionService {
  /**
   * Create a new passkey session for OAuth+PKCE flow
   */
  async createSession(params: CreateSessionParams): Promise<{ sessionId: string; expiresAt: Date }> {
    // Generate unique session ID (URL-safe)
    const sessionId = randomBytes(32).toString('base64url');

    // Encrypt userShare for storage (using simple encoding for now, should use proper encryption)
    const encryptedUserShare = Buffer.from(params.userShareHex, 'hex').toString('base64');

    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MINUTES * 60 * 1000);

    await db.insert(passkeySessions).values({
      sessionId,
      codeChallenge: params.codeChallenge,
      userId: params.userId,
      telegramId: params.telegramId,
      walletId: params.walletId,
      partyId: params.partyId,
      emailAtCreation: params.email.toLowerCase(),
      encryptedUserShare,
      displayName: params.displayName || 'CC Bot User',
      status: 'pending',
      requestIp: params.ipAddress,
      userAgent: params.userAgent,
      expiresAt,
    });

    logger.info('Created session', { sessionId, walletId: params.walletId, expiresAt: expiresAt.toISOString() });

    return { sessionId, expiresAt };
  }

  /**
   * Get session data for external browser (without code verification)
   * This is called by Safari to get the challenge and wallet info
   *
   * SECURITY: This method NEVER returns userShareHex.
   * Shares must never be exposed in API responses.
   */
  async getSessionForAuth(sessionId: string): Promise<SessionData | null> {
    const [session] = await db
      .select()
      .from(passkeySessions)
      .where(
        and(
          eq(passkeySessions.sessionId, sessionId),
          eq(passkeySessions.status, 'pending'),
          gt(passkeySessions.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!session) {
      logger.debug('Session not found or expired', { sessionId });
      return null;
    }

    // SECURITY: Do NOT return userShareHex - it stays server-side
    return {
      sessionId: session.sessionId,
      walletId: session.walletId,
      partyId: session.partyId,
      displayName: session.displayName || 'CC Bot User',
      status: session.status,
    };
  }

  /**
   * INTERNAL: Get full session data including userShareHex (for server-side operations only)
   * This is used by the /complete endpoint to register the passkey with the share.
   *
   * SECURITY: This method is for INTERNAL USE ONLY.
   * The returned data must NEVER be sent in an API response.
   */
  async getSessionInternal(sessionId: string): Promise<InternalSessionData | null> {
    const [session] = await db
      .select()
      .from(passkeySessions)
      .where(
        and(
          eq(passkeySessions.sessionId, sessionId),
          eq(passkeySessions.status, 'pending'),
          gt(passkeySessions.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!session) {
      logger.debug('Session not found or expired for internal lookup', { sessionId });
      return null;
    }

    // Decrypt userShare for internal server-side use (only for normal flow with wallet)
    const userShareHex = session.encryptedUserShare
      ? Buffer.from(session.encryptedUserShare, 'base64').toString('hex')
      : null;

    return {
      sessionId: session.sessionId,
      userId: session.userId,
      walletId: session.walletId,
      partyId: session.partyId,
      email: session.emailAtCreation,
      userShareHex,
      displayName: session.displayName || 'CC Bot User',
      status: session.status,
    };
  }

  /**
   * Verify PKCE and complete session in one atomic operation.
   * SECURITY: Requires PKCE code_verifier to prove the caller owns the session.
   *
   * Returns the full session data (including userShareHex) ONLY if PKCE verification succeeds.
   * The userShareHex is for SERVER-SIDE use only and must NEVER be returned in an API response.
   */
  async verifyPkceAndComplete(
    sessionId: string,
    credentialId: string,
    codeVerifier: string
  ): Promise<{ success: boolean; error?: string; session?: InternalSessionData }> {
    // First, fetch the session to verify PKCE
    const [session] = await db
      .select()
      .from(passkeySessions)
      .where(
        and(
          eq(passkeySessions.sessionId, sessionId),
          eq(passkeySessions.status, 'pending'),
          gt(passkeySessions.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!session) {
      logger.debug('Session not found or expired for PKCE verification', { sessionId });
      return { success: false, error: 'Session not found or expired' };
    }

    // CRITICAL: Verify PKCE code_verifier matches code_challenge
    const computedChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    if (computedChallenge !== session.codeChallenge) {
      logger.warn('PKCE verification failed - code_verifier does not match', { sessionId });
      return { success: false, error: 'PKCE verification failed' };
    }

    // PKCE verified - now complete the session
    const result = await db
      .update(passkeySessions)
      .set({
        status: 'completed',
        completedCredentialId: credentialId,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(passkeySessions.sessionId, sessionId),
          eq(passkeySessions.status, 'pending'),
          gt(passkeySessions.expiresAt, new Date())
        )
      );

    const updated = getAffectedRows(result) > 0;
    logger.info('Completed session with PKCE verification', { sessionId, updated });

    if (!updated) {
      return { success: false, error: 'Failed to complete session' };
    }

    // Decrypt userShare for internal server-side use ONLY
    // SECURITY: This is returned to the caller (route handler) but must NEVER be in an API response
    const userShareHex = session.encryptedUserShare
      ? Buffer.from(session.encryptedUserShare, 'base64').toString('hex')
      : null;

    return {
      success: true,
      session: {
        sessionId: session.sessionId,
        userId: session.userId,
        walletId: session.walletId,
        partyId: session.partyId,
        email: session.emailAtCreation, // Email at session creation for passkey binding
        userShareHex,
        displayName: session.displayName || 'CC Bot User',
        status: 'completed',
      },
    };
  }

  /**
   * @deprecated Use verifyPkceAndComplete instead for atomic PKCE verification + completion
   */
  async completeSession(sessionId: string, credentialId: string, codeVerifier: string): Promise<{ success: boolean; error?: string }> {
    const result = await this.verifyPkceAndComplete(sessionId, credentialId, codeVerifier);
    if (result.error) {
      return { success: result.success, error: result.error };
    }
    return { success: result.success };
  }

  /**
   * Check session status (for Mini App polling)
   */
  async checkSessionStatus(sessionId: string, codeVerifier: string): Promise<{
    status: 'pending' | 'completed' | 'expired' | 'invalid';
    credentialId?: string;
  }> {
    const [session] = await db
      .select()
      .from(passkeySessions)
      .where(eq(passkeySessions.sessionId, sessionId))
      .limit(1);

    if (!session) {
      return { status: 'invalid' };
    }

    // Verify PKCE code_verifier matches code_challenge
    const computedChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    if (computedChallenge !== session.codeChallenge) {
      logger.warn('PKCE verification failed during status check', { sessionId });
      return { status: 'invalid' };
    }

    // Check expiry
    if (new Date() > session.expiresAt) {
      return { status: 'expired' };
    }

    if (session.status === 'completed') {
      // Mark as used so it can't be checked again
      await db
        .update(passkeySessions)
        .set({ status: 'used' })
        .where(eq(passkeySessions.sessionId, sessionId));

      const credentialId = session.completedCredentialId;
      if (credentialId) {
        return { status: 'completed', credentialId };
      }
      return { status: 'completed' };
    }

    return { status: 'pending' };
  }

  /**
   * Get session by wallet ID (for checking if passkey setup is in progress)
   */
  async getPendingSessionByWallet(walletId: string): Promise<{ sessionId: string } | null> {
    const [session] = await db
      .select({ sessionId: passkeySessions.sessionId })
      .from(passkeySessions)
      .where(
        and(
          eq(passkeySessions.walletId, walletId),
          eq(passkeySessions.status, 'pending'),
          gt(passkeySessions.expiresAt, new Date())
        )
      )
      .limit(1);

    return session || null;
  }

  /**
   * Cleanup expired sessions (called periodically)
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await db
      .delete(passkeySessions)
      .where(
        and(
          lt(passkeySessions.expiresAt, new Date()),
          eq(passkeySessions.status, 'pending')
        )
      );

    const deleted = getAffectedRows(result);
    if (deleted > 0) {
      logger.info('Cleaned up expired sessions', { count: deleted });
    }

    return deleted;
  }

  // ==================== PASSKEY-ONLY FLOW (NEW) ====================

  /**
   * Create a passkey-only session (no wallet data)
   * Used for the new flow where passkey is created BEFORE wallet
   * SECURITY: Requires userId and verified email for binding
   */
  async createPasskeyOnlySession(params: {
    userId: string;
    telegramId: string;
    email: string; // User's verified email
    codeChallenge: string;
    displayName?: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ sessionId: string; expiresAt: Date }> {
    const sessionId = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MINUTES * 60 * 1000);

    // Use NULL for wallet-related fields (they're not used in passkey-only flow)
    // These will be set when the wallet is actually created after passkey registration

    await db.insert(passkeySessions).values({
      sessionId,
      codeChallenge: params.codeChallenge,
      userId: params.userId,
      telegramId: params.telegramId,
      walletId: null, // NULL for passkey-only flow - will be set when wallet is created
      partyId: null,  // NULL for passkey-only flow
      emailAtCreation: params.email.toLowerCase(),
      encryptedUserShare: null,   // Not used in passkey-only flow
      displayName: params.displayName || 'CC Bot User',
      status: 'pending',
      requestIp: params.ipAddress,
      userAgent: params.userAgent,
      expiresAt,
    });

    logger.info('Created passkey-only session', { sessionId, telegramId: params.telegramId });

    return { sessionId, expiresAt };
  }

  /**
   * Get passkey-only session for external browser
   */
  async getPasskeyOnlySession(sessionId: string): Promise<{ displayName: string } | null> {
    const [session] = await db
      .select()
      .from(passkeySessions)
      .where(
        and(
          eq(passkeySessions.sessionId, sessionId),
          isNull(passkeySessions.walletId),
          eq(passkeySessions.status, 'pending'),
          gt(passkeySessions.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!session) {
      logger.debug('Passkey-only session not found or expired', { sessionId });
      return null;
    }

    return {
      displayName: session.displayName || 'CC Bot User',
    };
  }

  /**
   * Complete passkey-only session - store credential (NO PKCE verification here)
   * PKCE verification happens when Telegram polls for status
   * This is called by Safari which doesn't have access to codeVerifier
   */
  async completePasskeyOnlySession(
    sessionId: string,
    credentialId: string,
    publicKeySpki: string,
    deviceName?: string
  ): Promise<{ success: boolean; error?: string }> {
    // Fetch session (no PKCE verification - that happens in status check)
    const [session] = await db
      .select()
      .from(passkeySessions)
      .where(
        and(
          eq(passkeySessions.sessionId, sessionId),
          isNull(passkeySessions.walletId),
          eq(passkeySessions.status, 'pending'),
          gt(passkeySessions.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!session) {
      logger.debug('Passkey-only session not found or expired for completion', { sessionId });
      return { success: false, error: 'Session not found or expired' };
    }

    logger.debug('Found session for completion', { sessionId, status: session.status, walletId: session.walletId });

    // Store the credential data - status stays 'pending' until PKCE is verified via polling
    // We'll store publicKeySpki in the encryptedUserShare field (repurposed for passkey-only)
    const credentialData = JSON.stringify({ credentialId, publicKeySpki, deviceName: deviceName || 'Unknown Device' });

    // Store credential but keep status as 'pending' - will be 'completed' after PKCE verification
    const result = await db
      .update(passkeySessions)
      .set({
        status: 'cred_ready', // Intermediate status (max 16 chars)
        completedCredentialId: credentialId,
        encryptedUserShare: credentialData, // Store credential data here
      })
      .where(
        and(
          eq(passkeySessions.sessionId, sessionId),
          eq(passkeySessions.status, 'pending')
        )
      );

    // Debug: log the full result to understand drizzle's return format
    logger.debug('Update result for passkey-only session', { sessionId, result: JSON.stringify(result) });
    const updated = getAffectedRows(result) > 0;
    logger.info('Stored credential for passkey-only session', { sessionId, updated });

    return { success: updated };
  }

  /**
   * Check passkey-only session status (for Mini App polling)
   */
  async checkPasskeyOnlySessionStatus(sessionId: string, codeVerifier: string): Promise<{
    status: 'pending' | 'completed' | 'expired' | 'invalid';
    credentialId?: string;
    publicKeySpki?: string;
  }> {
    const [session] = await db
      .select()
      .from(passkeySessions)
      .where(
        and(
          eq(passkeySessions.sessionId, sessionId),
          isNull(passkeySessions.walletId)
        )
      )
      .limit(1);

    if (!session) {
      return { status: 'invalid' };
    }

    // Verify PKCE
    const computedChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    if (computedChallenge !== session.codeChallenge) {
      logger.warn('PKCE verification failed for passkey-only session', { sessionId });
      return { status: 'invalid' };
    }

    // Check expiry
    if (new Date() > session.expiresAt) {
      return { status: 'expired' };
    }

    // Handle cred_ready status - PKCE verified, now mark as completed
    if (session.status === 'cred_ready') {
      // PKCE verified! Mark session as completed
      await db
        .update(passkeySessions)
        .set({
          status: 'completed',
          completedAt: new Date(),
        })
        .where(eq(passkeySessions.sessionId, sessionId));

      // Parse credential data
      try {
        if (!session.encryptedUserShare) {
          throw new Error('No credential data');
        }
        const credentialData = JSON.parse(session.encryptedUserShare);
        return {
          status: 'completed' as const,
          credentialId: credentialData.credentialId as string,
          publicKeySpki: credentialData.publicKeySpki as string,
        };
      } catch {
        // Fallback if parsing fails
        const credId = session.completedCredentialId;
        return {
          status: 'completed' as const,
          ...(credId && { credentialId: credId }),
        };
      }
    }

    if (session.status === 'completed') {
      // Already completed - mark as used
      await db
        .update(passkeySessions)
        .set({ status: 'used' })
        .where(eq(passkeySessions.sessionId, sessionId));

      // Parse credential data
      try {
        if (!session.encryptedUserShare) {
          throw new Error('No credential data');
        }
        const credentialData = JSON.parse(session.encryptedUserShare);
        return {
          status: 'completed' as const,
          credentialId: credentialData.credentialId as string,
          publicKeySpki: credentialData.publicKeySpki as string,
        };
      } catch {
        // Fallback if parsing fails
        const credId = session.completedCredentialId;
        return {
          status: 'completed' as const,
          ...(credId && { credentialId: credId }),
        };
      }
    }

    return { status: 'pending' };
  }
}

export const passkeySessionService = new PasskeySessionService();
