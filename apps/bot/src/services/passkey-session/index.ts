import { eq, and, gt, lt, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { passkeySessions } from '../../db/schema.js';
import { randomBytes, createHash } from 'crypto';

const SESSION_EXPIRY_MINUTES = 5;

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
  walletId: string;
  partyId: string;
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
  userShareHex: string;
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

    console.log(`[PasskeySession] Created session ${sessionId} for wallet ${params.walletId}, expires at ${expiresAt}`);

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
      console.log(`[PasskeySession] Session not found or expired: ${sessionId}`);
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
      console.log(`[PasskeySession] Session not found or expired: ${sessionId}`);
      return null;
    }

    // Decrypt userShare for internal server-side use
    const userShareHex = Buffer.from(session.encryptedUserShare, 'base64').toString('hex');

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
      console.log(`[PasskeySession] Session not found or expired: ${sessionId}`);
      return { success: false, error: 'Session not found or expired' };
    }

    // CRITICAL: Verify PKCE code_verifier matches code_challenge
    const computedChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    if (computedChallenge !== session.codeChallenge) {
      console.log(`[PasskeySession] PKCE verification failed for session ${sessionId} - code_verifier does not match code_challenge`);
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

    const updated = (result as any).rowCount > 0 || (result as any).changes > 0;
    console.log(`[PasskeySession] Completed session ${sessionId} with PKCE verification: ${updated}`);

    if (!updated) {
      return { success: false, error: 'Failed to complete session' };
    }

    // Decrypt userShare for internal server-side use ONLY
    // SECURITY: This is returned to the caller (route handler) but must NEVER be in an API response
    const userShareHex = Buffer.from(session.encryptedUserShare, 'base64').toString('hex');

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
      console.log(`[PasskeySession] PKCE verification failed for session ${sessionId}`);
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

    const deleted = (result as any).rowCount || 0;
    if (deleted > 0) {
      console.log(`[PasskeySession] Cleaned up ${deleted} expired sessions`);
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

    console.log(`[PasskeySession] Created passkey-only session ${sessionId} for telegram ${params.telegramId}`);

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
      console.log(`[PasskeySession] Passkey-only session not found or expired: ${sessionId}`);
      return null;
    }

    return {
      displayName: session.displayName || 'CC Bot User',
    };
  }

  /**
   * Complete passkey-only session with PKCE verification
   */
  async completePasskeyOnlySession(
    sessionId: string,
    credentialId: string,
    publicKeySpki: string,
    codeVerifier: string,
    deviceName?: string
  ): Promise<{ success: boolean; error?: string }> {
    // Fetch session to verify PKCE
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
      console.log(`[PasskeySession] Passkey-only session not found or expired: ${sessionId}`);
      return { success: false, error: 'Session not found or expired' };
    }

    console.log(`[PasskeySession] Found session: status=${session.status}, walletId=${session.walletId}, expires=${session.expiresAt}`);

    // Verify PKCE
    const computedChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    if (computedChallenge !== session.codeChallenge) {
      console.log(`[PasskeySession] PKCE verification failed for passkey-only session ${sessionId}`);
      return { success: false, error: 'PKCE verification failed' };
    }

    // Store the credential data in a special way for later retrieval
    // We'll store publicKeySpki in the encryptedUserShare field (repurposed for passkey-only)
    const credentialData = JSON.stringify({ credentialId, publicKeySpki, deviceName: deviceName || 'Unknown Device' });

    // Complete the session
    const result = await db
      .update(passkeySessions)
      .set({
        status: 'completed',
        completedCredentialId: credentialId,
        encryptedUserShare: credentialData, // Store credential data here
        completedAt: new Date(),
      })
      .where(
        and(
          eq(passkeySessions.sessionId, sessionId),
          eq(passkeySessions.status, 'pending')
        )
      );

    // Debug: log the full result to understand drizzle's return format
    console.log(`[PasskeySession] Update result:`, JSON.stringify(result));
    const updated = (result as any).rowCount > 0 || (result as any).changes > 0 || (result as any).count > 0;
    console.log(`[PasskeySession] Completed passkey-only session ${sessionId}: ${updated}`);

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
      console.log(`[PasskeySession] PKCE verification failed for passkey-only session ${sessionId}`);
      return { status: 'invalid' };
    }

    // Check expiry
    if (new Date() > session.expiresAt) {
      return { status: 'expired' };
    }

    if (session.status === 'completed') {
      // Mark as used
      await db
        .update(passkeySessions)
        .set({ status: 'used' })
        .where(eq(passkeySessions.sessionId, sessionId));

      // Parse credential data
      try {
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
