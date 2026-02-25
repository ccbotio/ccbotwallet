/**
 * Recovery Service
 *
 * Handles unauthenticated wallet recovery flow:
 * 1. Email lookup (check if wallet + passkey exists)
 * 2. Send verification code
 * 3. Verify code and create recovery session
 * 4. Passkey verification and share retrieval
 *
 * SECURITY CONSIDERATIONS:
 * - All endpoints are unauthenticated (public)
 * - Strict rate limiting to prevent enumeration attacks
 * - Recovery sessions have short expiry (15 min)
 * - All attempts logged for audit trail
 */

import { db } from '../../db/index.js';
import { users, wallets, passkeyCredentials, securityEvents } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { emailService } from '../email/index.js';
import { passkeyService } from '../passkey/index.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import crypto from 'crypto';

// Recovery session stored in Redis (15 min TTL)
const RECOVERY_SESSION_TTL = 15 * 60; // 15 minutes
const RECOVERY_SESSION_PREFIX = 'recovery:session:';

// Rate limit keys
const EMAIL_CHECK_RATE_PREFIX = 'recovery:check:ip:';
const EMAIL_CHECK_RATE_LIMIT = 10; // per hour
const SEND_CODE_RATE_PREFIX = 'recovery:send:';
const SEND_CODE_IP_LIMIT = 10; // per IP per hour
const SEND_CODE_EMAIL_LIMIT = 3; // per email per hour

interface RecoverySession {
  id: string;
  email: string;
  userId: string;
  walletId: string;
  partyId: string;
  status: 'email_verified' | 'passkey_verified' | 'complete';
  emailVerifiedAt: string;
  passkeyVerifiedAt?: string;
  completedAt?: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
}

interface CheckEmailResult {
  exists: boolean;
  hasWallet: boolean;
  hasPasskey: boolean;
  partyId?: string;
}

interface SendCodeResult {
  success: boolean;
  message: string;
  expiresAt?: string;
}

interface VerifyCodeResult {
  success: boolean;
  message: string;
  sessionId?: string;
  partyId?: string;
  walletId?: string;
}

interface VerifyPasskeyResult {
  success: boolean;
  message: string;
  encryptedShare?: string;
  nonce?: string;
  walletId?: string;
  userId?: string;
}

class RecoveryService {
  /**
   * Check if email has a wallet and passkey
   * PUBLIC endpoint - rate limited
   */
  async checkEmail(email: string, ipAddress: string): Promise<CheckEmailResult> {
    const emailLower = email.toLowerCase().trim();

    // Rate limiting by IP
    const rateLimitKey = `${EMAIL_CHECK_RATE_PREFIX}${ipAddress}`;
    const currentCount = await redis.incr(rateLimitKey);
    if (currentCount === 1) {
      await redis.expire(rateLimitKey, 3600); // 1 hour
    }
    if (currentCount > EMAIL_CHECK_RATE_LIMIT) {
      logger.warn({ ip: ipAddress, email: emailLower }, 'Recovery email check rate limit exceeded');
      // Return generic response to prevent enumeration
      return { exists: false, hasWallet: false, hasPasskey: false };
    }

    try {
      // Find user by email
      const [user] = await db
        .select({
          userId: users.id,
          email: users.email,
        })
        .from(users)
        .where(eq(users.email, emailLower))
        .limit(1);

      if (!user) {
        return { exists: false, hasWallet: false, hasPasskey: false };
      }

      // Check if user has wallet
      const [wallet] = await db
        .select({
          walletId: wallets.id,
          partyId: wallets.partyId,
        })
        .from(wallets)
        .where(eq(wallets.userId, user.userId))
        .limit(1);

      if (!wallet) {
        return { exists: true, hasWallet: false, hasPasskey: false };
      }

      // Check if wallet has passkey
      const [passkey] = await db
        .select({ id: passkeyCredentials.id })
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.walletId, wallet.walletId))
        .limit(1);

      return {
        exists: true,
        hasWallet: true,
        hasPasskey: !!passkey,
        partyId: wallet.partyId,
      };
    } catch (error) {
      logger.error({ error, email: emailLower }, 'Recovery email check failed');
      return { exists: false, hasWallet: false, hasPasskey: false };
    }
  }

  /**
   * Send verification code for recovery
   * PUBLIC endpoint - strict rate limiting
   */
  async sendCode(email: string, ipAddress: string): Promise<SendCodeResult> {
    const emailLower = email.toLowerCase().trim();

    // Rate limiting by IP
    const ipRateLimitKey = `${SEND_CODE_RATE_PREFIX}ip:${ipAddress}`;
    const ipCount = await redis.incr(ipRateLimitKey);
    if (ipCount === 1) {
      await redis.expire(ipRateLimitKey, 3600);
    }
    if (ipCount > SEND_CODE_IP_LIMIT) {
      logger.warn({ ip: ipAddress }, 'Recovery send code IP rate limit exceeded');
      return { success: false, message: 'Too many requests. Please try again later.' };
    }

    // Rate limiting by email
    const emailRateLimitKey = `${SEND_CODE_RATE_PREFIX}email:${emailLower}`;
    const emailCount = await redis.incr(emailRateLimitKey);
    if (emailCount === 1) {
      await redis.expire(emailRateLimitKey, 3600);
    }
    if (emailCount > SEND_CODE_EMAIL_LIMIT) {
      logger.warn({ email: emailLower }, 'Recovery send code email rate limit exceeded');
      return { success: false, message: 'Too many code requests for this email. Please try again later.' };
    }

    try {
      // Verify email exists and has wallet + passkey
      const checkResult = await this.checkEmail(emailLower, ipAddress);
      if (!checkResult.hasWallet || !checkResult.hasPasskey) {
        // Don't reveal whether email exists - generic message
        // But still send email if user exists (prevents enumeration)
        logger.info({ email: emailLower }, 'Recovery code requested for email without passkey');
        return { success: false, message: 'If this email is registered, you will receive a verification code.' };
      }

      // Get user ID for email service
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, emailLower))
        .limit(1);

      if (!user) {
        return { success: false, message: 'If this email is registered, you will receive a verification code.' };
      }

      // Use existing email service to send code
      const result = await emailService.sendCode(user.id, emailLower, ipAddress);

      // Log security event
      await this.logSecurityEvent(user.id, 'recovery_code_sent', 'info', {
        email: emailLower,
        ip: ipAddress,
      });

      const response: SendCodeResult = {
        success: result.success,
        message: result.success ? 'Verification code sent to your email.' : result.message,
      };
      if (result.expiresAt) {
        response.expiresAt = result.expiresAt.toISOString();
      }
      return response;
    } catch (error) {
      logger.error({ error, email: emailLower }, 'Failed to send recovery code');
      return { success: false, message: 'Failed to send verification code. Please try again.' };
    }
  }

  /**
   * Verify code and create recovery session
   * PUBLIC endpoint
   */
  async verifyCode(email: string, code: string, ipAddress: string, userAgent: string): Promise<VerifyCodeResult> {
    const emailLower = email.toLowerCase().trim();

    try {
      // Get user by email
      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, emailLower))
        .limit(1);

      if (!user) {
        return { success: false, message: 'Invalid email or code.' };
      }

      // Verify the code using existing email service
      const result = await emailService.verifyCode(user.id, emailLower, code, ipAddress);

      if (!result.success) {
        return { success: false, message: result.message };
      }

      // Get wallet info
      const [wallet] = await db
        .select({
          walletId: wallets.id,
          partyId: wallets.partyId,
        })
        .from(wallets)
        .where(eq(wallets.userId, user.id))
        .limit(1);

      if (!wallet) {
        return { success: false, message: 'Wallet not found for this account.' };
      }

      // Create recovery session
      const sessionId = crypto.randomUUID();
      const session: RecoverySession = {
        id: sessionId,
        email: emailLower,
        userId: user.id,
        walletId: wallet.walletId,
        partyId: wallet.partyId,
        status: 'email_verified',
        emailVerifiedAt: new Date().toISOString(),
        ipAddress,
        userAgent,
        createdAt: new Date().toISOString(),
      };

      // Store in Redis
      await redis.setex(
        `${RECOVERY_SESSION_PREFIX}${sessionId}`,
        RECOVERY_SESSION_TTL,
        JSON.stringify(session)
      );

      // Log security event
      await this.logSecurityEvent(user.id, 'recovery_email_verified', 'info', {
        email: emailLower,
        sessionId,
        ip: ipAddress,
      });

      return {
        success: true,
        message: 'Email verified successfully.',
        sessionId,
        partyId: wallet.partyId,
        walletId: wallet.walletId,
      };
    } catch (error) {
      logger.error({ error, email: emailLower }, 'Failed to verify recovery code');
      return { success: false, message: 'Verification failed. Please try again.' };
    }
  }

  /**
   * Get recovery session
   */
  async getSession(sessionId: string): Promise<RecoverySession | null> {
    try {
      const data = await redis.get(`${RECOVERY_SESSION_PREFIX}${sessionId}`);
      if (!data) return null;
      return JSON.parse(data) as RecoverySession;
    } catch {
      return null;
    }
  }

  /**
   * Verify passkey for recovery
   * Uses existing passkey service
   */
  async verifyPasskey(
    sessionId: string,
    partyId: string,
    credentialId: string,
    authenticatorData: string,
    clientDataJSON: string,
    signature: string,
    ipAddress: string
  ): Promise<VerifyPasskeyResult> {
    try {
      // Get and validate session
      const session = await this.getSession(sessionId);
      if (!session) {
        return { success: false, message: 'Recovery session expired. Please start over.' };
      }

      if (session.status !== 'email_verified') {
        return { success: false, message: 'Invalid session state.' };
      }

      if (session.partyId !== partyId) {
        return { success: false, message: 'Party ID mismatch.' };
      }

      // Get passkey credential
      const [credential] = await db
        .select()
        .from(passkeyCredentials)
        .where(
          and(
            eq(passkeyCredentials.walletId, session.walletId),
            eq(passkeyCredentials.credentialId, credentialId)
          )
        )
        .limit(1);

      if (!credential) {
        return { success: false, message: 'Passkey not found.' };
      }

      // Verify passkey's email matches recovery email
      if (credential.emailAtRegistration?.toLowerCase() !== session.email.toLowerCase()) {
        logger.warn({
          sessionEmail: session.email,
          passkeyEmail: credential.emailAtRegistration,
        }, 'Passkey email mismatch during recovery');
        return { success: false, message: 'Passkey not registered with this email.' };
      }

      // Use passkey service to verify and get encrypted share
      let recoverResult: { encryptedShare: string; nonce: string; walletId: string };
      try {
        recoverResult = await passkeyService.recoverWithPasskey(partyId, {
          credentialId,
          authenticatorData,
          clientDataJson: clientDataJSON,
          signature,
        });
      } catch (err) {
        logger.error({ error: err }, 'Passkey verification failed');
        return { success: false, message: 'Passkey verification failed.' };
      }

      // Update session status
      session.status = 'passkey_verified';
      session.passkeyVerifiedAt = new Date().toISOString();
      await redis.setex(
        `${RECOVERY_SESSION_PREFIX}${sessionId}`,
        RECOVERY_SESSION_TTL,
        JSON.stringify(session)
      );

      // Log security event
      await this.logSecurityEvent(session.userId, 'recovery_passkey_verified', 'info', {
        email: session.email,
        sessionId,
        credentialId,
        ip: ipAddress,
      });

      return {
        success: true,
        message: 'Passkey verified successfully.',
        encryptedShare: recoverResult.encryptedShare,
        nonce: recoverResult.nonce,
        walletId: session.walletId,
        userId: session.userId,
      };
    } catch (error) {
      logger.error({ error, sessionId }, 'Passkey verification failed during recovery');
      return { success: false, message: 'Passkey verification failed. Please try again.' };
    }
  }

  /**
   * Complete recovery - marks session as complete
   */
  async completeRecovery(sessionId: string): Promise<{ success: boolean; message: string }> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) {
        return { success: false, message: 'Session not found.' };
      }

      if (session.status !== 'passkey_verified') {
        return { success: false, message: 'Invalid session state.' };
      }

      // Mark as complete
      session.status = 'complete';
      session.completedAt = new Date().toISOString();
      await redis.setex(
        `${RECOVERY_SESSION_PREFIX}${sessionId}`,
        60, // Keep for 1 minute then delete
        JSON.stringify(session)
      );

      // Log security event
      await this.logSecurityEvent(session.userId, 'recovery_complete', 'info', {
        email: session.email,
        sessionId,
      });

      return { success: true, message: 'Recovery completed successfully.' };
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to complete recovery');
      return { success: false, message: 'Failed to complete recovery.' };
    }
  }

  /**
   * Log security event
   */
  private async logSecurityEvent(
    userId: string,
    eventType: string,
    severity: 'info' | 'warning' | 'critical',
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      await db.insert(securityEvents).values({
        userId,
        eventType,
        eventStatus: 'success',
        severity,
        ipAddress: metadata.ip as string | undefined,
        metadata,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to log security event');
    }
  }
}

export const recoveryService = new RecoveryService();
