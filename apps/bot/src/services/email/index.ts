import { eq, and, gt, lt, desc } from 'drizzle-orm';
import { randomInt, createHash } from 'node:crypto';
import { Resend } from 'resend';
import { db, emailCodes, users, blockedEmailDomains, securityEvents } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { RATE_LIMITS } from '../../config/constants.js';
import {
  checkEmailSendLimit,
  checkEmailDailyLimit,
  checkEmailIpLimit,
  checkEmailResendCooldown,
} from '../../api/middleware/rate-limit.js';

// Resend client - only initialized if API key is provided
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

// DEV MODE: Uses extended code validity (24 hours instead of 5 minutes)
const DEV_MODE = true;

// Code validity: 5 minutes in production, 24 hours in dev
const EMAIL_CODE_EXPIRY_MINUTES = DEV_MODE
  ? RATE_LIMITS.emailCodeValidityDev / 60
  : RATE_LIMITS.emailCodeValidity / 60;

const MAX_ATTEMPTS = RATE_LIMITS.emailVerify.max;

// SECURITY: Hardcoded list of common disposable email domains
// This is checked first, then database for custom blocks
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  // Major disposable email services
  'tempmail.com', 'temp-mail.org', 'guerrillamail.com', 'guerrillamail.org',
  '10minutemail.com', '10minutemail.net', 'mailinator.com', 'mailinator.net',
  'throwaway.email', 'throwawaymail.com', 'tempail.com', 'fakeinbox.com',
  'trashmail.com', 'trashmail.net', 'mailnesia.com', 'maildrop.cc',
  'dispostable.com', 'sharklasers.com', 'guerrillamailblock.com',
  'pokemail.net', 'spam4.me', 'grr.la', 'spamgourmet.com',
  'mytrashmail.com', 'mt2009.com', 'thankyou2010.com',
  'trash2009.com', 'mt2014.com', 'temp.email', 'tmpmail.org',
  'mohmal.com', 'emailondeck.com', 'tempmailo.com', 'tempmailaddress.com',
  'burnermail.io', 'inboxkitten.com', 'mailsac.com', 'yopmail.com',
  'yopmail.fr', 'yopmail.net', 'cool.fr.nf', 'jetable.fr.nf',
  'nospam.ze.tc', 'nomail.xl.cx', 'mega.zik.dj', 'speed.1s.fr',
  'courriel.fr.nf', 'moncourrier.fr.nf', 'monemail.fr.nf',
  'monmail.fr.nf', 'hide.biz.st', 'mymail.infos.st',
  'getnada.com', 'tempinbox.com', 'discard.email', 'discardmail.com',
  'spambox.us', 'spamfree24.org', 'spamfree24.de', 'spamfree24.eu',
  'spamfree24.info', 'spamfree24.net', 'wegwerfmail.de', 'wegwerfmail.net',
  'wegwerfmail.org', 'emkei.cz', 'anonymbox.com', 'tempr.email',
  'fakemailgenerator.com', 'emailfake.com', 'generator.email',
  'tempemailco.com', 'emailtemporario.com.br', 'mintemail.com',
  'mohmal.im', 'mohmal.tech', 'dropmail.me', 'gmailnator.com',
]);

interface SendCodeResult {
  success: boolean;
  message: string;
  expiresAt?: Date;
}

interface VerifyCodeResult {
  success: boolean;
  message: string;
}

export class EmailService {
  /**
   * Generate a cryptographically secure 6-digit verification code
   */
  private generateCode(): string {
    return randomInt(100000, 1000000).toString();
  }

  /**
   * Hash a code for secure storage (we don't store plaintext codes in DB)
   */
  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /**
   * SECURITY: Check if email domain is a disposable/temporary email service
   */
  async isDisposableEmail(email: string): Promise<{ blocked: boolean; reason?: string }> {
    const domain = email.toLowerCase().split('@')[1];
    if (!domain) {
      return { blocked: true, reason: 'Invalid email format' };
    }

    // Check hardcoded list first (fastest)
    if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
      logger.warn({ email, domain }, 'Blocked disposable email (hardcoded list)');
      return { blocked: true, reason: 'Disposable email addresses are not allowed' };
    }

    // Check database for custom blocks
    try {
      const [blockedDomain] = await db
        .select()
        .from(blockedEmailDomains)
        .where(eq(blockedEmailDomains.domain, domain))
        .limit(1);

      if (blockedDomain) {
        logger.warn({ email, domain, reason: blockedDomain.reason }, 'Blocked email domain (DB)');
        return { blocked: true, reason: blockedDomain.reason ?? 'Email domain not allowed' };
      }
    } catch (error) {
      // DB check failed, continue with hardcoded list only
      logger.error({ error }, 'Failed to check blocked email domains in DB');
    }

    return { blocked: false };
  }

  /**
   * SECURITY: Check IP-based rate limit
   * Uses centralized rate limit from middleware
   */
  async checkIpRateLimit(ipAddress: string): Promise<{ allowed: boolean; remaining: number }> {
    if (!ipAddress) {
      return { allowed: true, remaining: RATE_LIMITS.emailIp.max };
    }
    return checkEmailIpLimit(ipAddress);
  }

  /**
   * SECURITY: Check global email rate limit (per email address)
   * Uses centralized rate limit from middleware
   */
  async checkGlobalEmailRateLimit(email: string): Promise<{ allowed: boolean; remaining: number }> {
    return checkEmailDailyLimit(email);
  }

  /**
   * SECURITY: Check user email send rate limit
   * Uses centralized rate limit from middleware
   */
  async checkUserEmailRateLimit(userId: string): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
    return checkEmailSendLimit(userId);
  }

  /**
   * SECURITY: Check email resend cooldown
   * Enforces minimum wait time between resends
   */
  async checkResendCooldown(userId: string): Promise<{ allowed: boolean; waitSeconds: number }> {
    return checkEmailResendCooldown(userId);
  }

  /**
   * SECURITY: Log security event to database
   */
  async logSecurityEvent(
    userId: string | null,
    eventType: string,
    status: 'success' | 'failed' | 'blocked',
    severity: 'info' | 'warning' | 'critical',
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      await db.insert(securityEvents).values({
        userId,
        eventType,
        eventStatus: status,
        severity,
        metadata,
      });
    } catch (error) {
      logger.error({ error, eventType }, 'Failed to log security event');
    }
  }

  /**
   * Generate HTML template for verification email
   * CC Bot brand colors: Purple #875CFF, Lilac #D5A5E3, Dark #030206, Light #FFFFFC
   */
  private getVerificationEmailHtml(code: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CC Bot Wallet - Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 440px; width: 100%; border-collapse: collapse; background: #ffffff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);">

          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px; border-bottom: 1px solid #e4e4e7;">
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center">
                    <h1 style="margin: 0; font-size: 20px; font-weight: 600; color: #18181b;">CC Bot Wallet</h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 32px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center">
                    <p style="margin: 0 0 24px; font-size: 14px; color: #71717a;">Your verification code is</p>
                  </td>
                </tr>
              </table>

              <!-- Code Box with Brand Colors -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 0 0 16px;">
                    <div style="display: inline-block; background: linear-gradient(135deg, rgba(135, 92, 255, 0.1) 0%, rgba(213, 165, 227, 0.1) 100%); border: 2px solid #875CFF; border-radius: 12px; padding: 16px 32px;">
                      <span style="font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Courier New', monospace; font-size: 28px; font-weight: 700; color: #875CFF; letter-spacing: 6px; user-select: all; -webkit-user-select: all;">${code}</span>
                    </div>
                    <p style="margin: 12px 0 0; font-size: 11px; color: #a1a1aa;">Tap to copy</p>
                  </td>
                </tr>
              </table>

              <!-- Expiry Notice -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding-bottom: 24px;">
                    <p style="margin: 0; font-size: 13px; color: #a1a1aa;">
                      This code will expire in <strong style="color: #71717a;">5 minutes</strong>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Security Notice -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="background: #fafafa; border-radius: 8px; padding: 16px;">
                    <p style="margin: 0; font-size: 12px; color: #71717a; line-height: 1.6;">
                      <strong style="color: #52525b;">Security Notice</strong><br>
                      Never share this code with anyone. CC Bot support will never ask for your verification code via phone, SMS, or social media.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; border-top: 1px solid #e4e4e7; background: #fafafa; border-radius: 0 0 16px 16px;">
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center">
                    <p style="margin: 0 0 8px; font-size: 12px; color: #a1a1aa;">
                      If you didn't request this code, you can safely ignore this email.
                    </p>
                    <p style="margin: 0; font-size: 11px; color: #d4d4d8;">
                      CC Bot Wallet &bull; Canton Network
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /**
   * Send verification email via Resend
   */
  private async sendVerificationEmail(email: string, code: string): Promise<boolean> {
    // If no Resend API key, log the code for development
    if (!resend) {
      logger.warn({ email, code }, '[DEV] Email would be sent - no RESEND_API_KEY configured');
      return true; // Return true so flow continues in dev
    }

    try {
      const { error } = await resend.emails.send({
        from: env.EMAIL_FROM,
        to: email,
        subject: 'Your Verification Code',
        html: this.getVerificationEmailHtml(code),
        text: `Your verification code is: ${code}. Valid for 5 minutes.`,
      });

      if (error) {
        logger.error({ err: error, email }, 'Failed to send verification email');
        return false;
      }

      logger.info({ email }, 'Verification email sent successfully');
      return true;
    } catch (error) {
      logger.error({ err: error, email }, 'Failed to send verification email');
      return false;
    }
  }

  /**
   * Send a verification code to the specified email
   * SECURITY: Includes disposable email blocking, IP rate limiting, and audit logging
   */
  async sendCode(userId: string, email: string, ipAddress?: string): Promise<SendCodeResult> {
    const emailLower = email.toLowerCase();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      await this.logSecurityEvent(userId, 'email_send_code', 'failed', 'warning', {
        email: emailLower,
        reason: 'invalid_format',
      });
      return { success: false, message: 'Invalid email format' };
    }

    // SECURITY: Check for disposable email
    const disposableCheck = await this.isDisposableEmail(email);
    if (disposableCheck.blocked) {
      await this.logSecurityEvent(userId, 'email_send_code', 'blocked', 'warning', {
        email: emailLower,
        reason: 'disposable_email',
        domain: emailLower.split('@')[1],
      });
      return { success: false, message: disposableCheck.reason ?? 'Email not allowed' };
    }

    // SECURITY: Check IP-based rate limit
    if (ipAddress) {
      const ipRateLimit = await this.checkIpRateLimit(ipAddress);
      if (!ipRateLimit.allowed) {
        await this.logSecurityEvent(userId, 'email_send_code', 'blocked', 'warning', {
          email: emailLower,
          ipAddress,
          reason: 'ip_rate_limit',
        });
        return { success: false, message: 'Too many requests. Please try again later.' };
      }
    }

    // SECURITY: Check global email rate limit (per email address)
    const globalRateLimit = await this.checkGlobalEmailRateLimit(emailLower);
    if (!globalRateLimit.allowed) {
      await this.logSecurityEvent(userId, 'email_send_code', 'blocked', 'warning', {
        email: emailLower,
        reason: 'email_rate_limit',
      });
      return { success: false, message: 'Too many verification attempts for this email. Please try again tomorrow.' };
    }

    // SECURITY: Check user-specific rate limit (uses centralized rate limiter)
    const userRateLimit = await this.checkUserEmailRateLimit(userId);
    if (!userRateLimit.allowed) {
      await this.logSecurityEvent(userId, 'email_send_code', 'blocked', 'warning', {
        email: emailLower,
        reason: 'user_rate_limit',
      });
      return { success: false, message: `Too many requests. Please try again in ${Math.ceil(userRateLimit.resetIn / 60)} minutes.` };
    }

    // SECURITY: Check resend cooldown (minimum wait between sends)
    const cooldown = await this.checkResendCooldown(userId);
    if (!cooldown.allowed) {
      return { success: false, message: `Please wait ${cooldown.waitSeconds} seconds before requesting another code.` };
    }

    // Generate code and expiry
    const code = this.generateCode();
    const codeHash = this.hashCode(code);
    const expiresAt = new Date(Date.now() + EMAIL_CODE_EXPIRY_MINUTES * 60 * 1000);

    // Store in database (with hash for security - original code still stored for backward compat)
    await db.insert(emailCodes).values({
      userId,
      email: emailLower,
      code, // Keep for backward compatibility
      codeHash, // New: hashed version
      requestIp: ipAddress,
      expiresAt,
    });

    // Send verification email
    const emailSent = await this.sendVerificationEmail(emailLower, code);

    if (!emailSent) {
      // Email failed but code is saved - user can request resend
      logger.warn(
        { userId, email: emailLower },
        'Email delivery failed, code saved for retry'
      );
      await this.logSecurityEvent(userId, 'email_send_code', 'failed', 'warning', {
        email: emailLower,
        reason: 'delivery_failed',
      });
    } else {
      await this.logSecurityEvent(userId, 'email_send_code', 'success', 'info', {
        email: emailLower,
      });
    }

    return {
      success: true,
      message: emailSent
        ? 'Verification code sent'
        : "Verification code generated. If you don't receive it, please try again.",
      expiresAt,
    };
  }

  /**
   * Verify the code entered by the user
   * SECURITY: Includes brute force protection and audit logging
   */
  async verifyCode(userId: string, email: string, code: string, ipAddress?: string): Promise<VerifyCodeResult> {
    const now = new Date();
    const emailLower = email.toLowerCase();

    // Find the latest unverified code for this user/email
    const [emailCode] = await db
      .select()
      .from(emailCodes)
      .where(
        and(
          eq(emailCodes.userId, userId),
          eq(emailCodes.email, emailLower),
          gt(emailCodes.expiresAt, now)
        )
      )
      .orderBy(desc(emailCodes.createdAt))
      .limit(1);

    if (!emailCode) {
      await this.logSecurityEvent(userId, 'email_verify', 'failed', 'warning', {
        email: emailLower,
        reason: 'code_not_found',
        ipAddress,
      });
      return { success: false, message: 'Code expired or not found. Please request a new code.' };
    }

    // Check if already verified
    if (emailCode.verifiedAt) {
      await this.logSecurityEvent(userId, 'email_verify', 'failed', 'warning', {
        email: emailLower,
        reason: 'code_already_used',
        ipAddress,
      });
      return { success: false, message: 'Code already used' };
    }

    // Check attempts
    if (emailCode.attempts >= MAX_ATTEMPTS) {
      await this.logSecurityEvent(userId, 'email_verify', 'blocked', 'warning', {
        email: emailLower,
        reason: 'max_attempts_exceeded',
        attempts: emailCode.attempts,
        ipAddress,
      });
      return { success: false, message: 'Too many attempts. Please request a new code.' };
    }

    // Increment attempts
    await db
      .update(emailCodes)
      .set({ attempts: emailCode.attempts + 1 })
      .where(eq(emailCodes.id, emailCode.id));

    // SECURITY: Verify code using constant-time comparison to prevent timing attacks
    const inputHash = this.hashCode(code);
    const storedHash = emailCode.codeHash ?? this.hashCode(emailCode.code); // Fallback for old records

    // Use timing-safe comparison
    let isValid = true;
    if (inputHash.length !== storedHash.length) {
      isValid = false;
    } else {
      let diff = 0;
      for (let i = 0; i < inputHash.length; i++) {
        diff |= inputHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
      }
      isValid = diff === 0;
    }

    if (!isValid) {
      const remaining = MAX_ATTEMPTS - emailCode.attempts - 1;
      await this.logSecurityEvent(userId, 'email_verify', 'failed', 'warning', {
        email: emailLower,
        reason: 'invalid_code',
        attempts: emailCode.attempts + 1,
        remaining,
        ipAddress,
      });
      return {
        success: false,
        message:
          remaining > 0
            ? `Invalid code. ${String(remaining)} attempts remaining.`
            : 'Too many attempts. Please request a new code.',
      };
    }

    // Mark as verified
    await db.update(emailCodes).set({ verifiedAt: now }).where(eq(emailCodes.id, emailCode.id));

    // SECURITY: Update user email verification status AND timestamp
    await db.update(users).set({
      isVerified: true,
      email: emailLower, // Ensure email is set
      emailVerifiedAt: now, // Track when email was verified
    }).where(eq(users.id, userId));

    await this.logSecurityEvent(userId, 'email_verify', 'success', 'info', {
      email: emailLower,
      ipAddress,
    });

    logger.info({ userId, email: emailLower }, 'Email verified successfully');

    return { success: true, message: 'Email verified successfully' };
  }

  /**
   * Check if a user has a verified email
   */
  async isEmailVerified(userId: string): Promise<boolean> {
    const [user] = await db
      .select({ isVerified: users.isVerified })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return user?.isVerified ?? false;
  }

  /**
   * Clean up expired verification codes.
   * Should be called periodically to prevent DB bloat.
   */
  async cleanupExpiredCodes(): Promise<number> {
    const now = new Date();

    const result = await db.delete(emailCodes).where(lt(emailCodes.expiresAt, now));

    const deletedCount = (result as { rowCount?: number }).rowCount ?? 0;

    if (deletedCount > 0) {
      logger.info({ deletedCount }, 'Cleaned up expired email codes');
    }

    return deletedCount;
  }

  /**
   * Send a raw email (for notifications, not verification)
   */
  async sendRawEmail(to: string, subject: string, html: string): Promise<boolean> {
    // If no Resend API key, log for development
    if (!resend) {
      logger.warn({ to, subject }, '[DEV] Email would be sent - no RESEND_API_KEY configured');
      return true;
    }

    try {
      const { error } = await resend.emails.send({
        from: env.EMAIL_FROM,
        to,
        subject,
        html,
      });

      if (error) {
        logger.error({ err: error, to }, 'Failed to send email');
        return false;
      }

      logger.info({ to, subject }, 'Email sent successfully');
      return true;
    } catch (error) {
      logger.error({ err: error, to }, 'Failed to send email');
      return false;
    }
  }
}

export const emailService = new EmailService();
