import { eq, and, gt, lt, desc } from 'drizzle-orm';
import { randomInt, createHash } from 'node:crypto';
import { Resend } from 'resend';
import { db, emailCodes, users, blockedEmailDomains, securityEvents } from '../../db/index.js';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';

// Resend client - only initialized if API key is provided
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

const EMAIL_CODE_EXPIRY_MINUTES = 5;
const MAX_ATTEMPTS = 5;
const RATE_LIMIT_MINUTES = 1;
const RATE_LIMIT_KEY_PREFIX = 'email:rate:';

// SECURITY: IP-based rate limiting to prevent email bombing
const IP_RATE_LIMIT_KEY_PREFIX = 'email:ip:';
const IP_RATE_LIMIT_MAX = 10; // Max 10 emails per hour per IP
const IP_RATE_LIMIT_WINDOW = 3600; // 1 hour in seconds

// SECURITY: Global email rate limit to prevent abuse
const GLOBAL_EMAIL_RATE_KEY = 'email:global:';
const GLOBAL_EMAIL_RATE_MAX = 5; // Max 5 codes per email per day
const GLOBAL_EMAIL_RATE_WINDOW = 86400; // 24 hours in seconds

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
   */
  async checkIpRateLimit(ipAddress: string): Promise<{ allowed: boolean; remaining: number }> {
    if (!ipAddress) {
      return { allowed: true, remaining: IP_RATE_LIMIT_MAX };
    }

    const key = `${IP_RATE_LIMIT_KEY_PREFIX}${ipAddress}`;
    const count = await redis.incr(key);

    // Set expiry on first request
    if (count === 1) {
      await redis.expire(key, IP_RATE_LIMIT_WINDOW);
    }

    const remaining = Math.max(0, IP_RATE_LIMIT_MAX - count);
    const allowed = count <= IP_RATE_LIMIT_MAX;

    if (!allowed) {
      logger.warn({ ipAddress, count }, 'IP rate limit exceeded for email');
    }

    return { allowed, remaining };
  }

  /**
   * SECURITY: Check global email rate limit (per email address)
   */
  async checkGlobalEmailRateLimit(email: string): Promise<{ allowed: boolean; remaining: number }> {
    const key = `${GLOBAL_EMAIL_RATE_KEY}${email.toLowerCase()}`;
    const count = await redis.incr(key);

    // Set expiry on first request
    if (count === 1) {
      await redis.expire(key, GLOBAL_EMAIL_RATE_WINDOW);
    }

    const remaining = Math.max(0, GLOBAL_EMAIL_RATE_MAX - count);
    const allowed = count <= GLOBAL_EMAIL_RATE_MAX;

    if (!allowed) {
      logger.warn({ email, count }, 'Global email rate limit exceeded');
    }

    return { allowed, remaining };
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
    // Split code into individual digits for styling
    const codeDigits = code.split('').map(digit =>
      `<span style="display: inline-block; width: 42px; height: 52px; line-height: 52px; background: linear-gradient(135deg, #875CFF 0%, #D5A5E3 100%); border-radius: 8px; margin: 0 3px; font-size: 24px; font-weight: 600; color: #FFFFFC; text-align: center;">${digit}</span>`
    ).join('');

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
                    <img src="data:image/png;base64,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" alt="CC Bot" width="56" height="56" style="display: block; margin: 0 auto;" />
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 16px;">
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
                    <p style="margin: 0 0 8px; font-size: 14px; color: #71717a;">Your verification code is</p>
                  </td>
                </tr>
              </table>

              <!-- Code Display -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 24px 0;">
                    ${codeDigits}
                  </td>
                </tr>
              </table>

              <!-- Copyable Code Box -->
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td align="center" style="padding: 0 0 16px;">
                    <div style="display: inline-block; background: #f4f4f5; border: 2px dashed #d4d4d8; border-radius: 8px; padding: 12px 24px;">
                      <span style="font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Courier New', monospace; font-size: 24px; font-weight: 600; color: #18181b; letter-spacing: 4px; user-select: all; -webkit-user-select: all;">${code}</span>
                    </div>
                    <p style="margin: 8px 0 0; font-size: 11px; color: #a1a1aa;">Tap to copy</p>
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

    // SECURITY: Check global email rate limit
    const globalRateLimit = await this.checkGlobalEmailRateLimit(emailLower);
    if (!globalRateLimit.allowed) {
      await this.logSecurityEvent(userId, 'email_send_code', 'blocked', 'warning', {
        email: emailLower,
        reason: 'email_rate_limit',
      });
      return { success: false, message: 'Too many verification attempts for this email. Please try again tomorrow.' };
    }

    // Check user-specific rate limit (1 code per minute)
    const rateLimitKey = `${RATE_LIMIT_KEY_PREFIX}${userId}`;
    const isRateLimited = await redis.get(rateLimitKey);
    if (isRateLimited) {
      return { success: false, message: 'Please wait before requesting another code' };
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

    // Set rate limit
    await redis.set(rateLimitKey, '1', 'EX', RATE_LIMIT_MINUTES * 60);

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
