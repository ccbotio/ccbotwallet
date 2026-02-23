/**
 * Production Configuration for CC Bot Wallet
 *
 * Domains:
 * - app.ccbot.io      → Main Mini App (Telegram only)
 * - security.ccbot.io → Passkey creation (redirect only)
 * - api.ccbot.io      → Backend API
 */

// Environment detection
export const isDevelopment = process.env.NODE_ENV === 'development';
export const isProduction = process.env.NODE_ENV === 'production';

// Domain configuration
export const config = {
  // API endpoint
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',

  // Main app domain (Telegram Mini App)
  appDomain: process.env.NEXT_PUBLIC_APP_DOMAIN || 'app.ccbot.io',

  // Security domain (Passkey creation)
  securityDomain: process.env.NEXT_PUBLIC_SECURITY_DOMAIN || 'security.ccbot.io',

  // Telegram bot username
  botUsername: process.env.NEXT_PUBLIC_BOT_USERNAME || 'ccbotwallet_bot',

  // Feature flags
  features: {
    // Skip Telegram check in development
    skipTelegramCheck: isDevelopment,

    // Allow direct access to security pages in development
    allowDirectSecurityAccess: isDevelopment,
  },
} as const;

/**
 * Get the full URL for the security domain
 */
export function getSecurityUrl(path: string = ''): string {
  if (isDevelopment) {
    // In development, use the same origin
    return path;
  }
  return `https://${config.securityDomain}${path}`;
}

/**
 * Get the full URL for the app domain
 */
export function getAppUrl(path: string = ''): string {
  if (isDevelopment) {
    return path;
  }
  return `https://${config.appDomain}${path}`;
}

/**
 * Check if running on security domain
 */
export function isSecurityDomain(): boolean {
  if (typeof window === 'undefined') return false;
  if (isDevelopment) {
    // In development, check if path starts with /passkey
    return window.location.pathname.startsWith('/passkey');
  }
  return window.location.hostname === config.securityDomain;
}

/**
 * Check if running on app domain
 */
export function isAppDomain(): boolean {
  if (typeof window === 'undefined') return false;
  if (isDevelopment) {
    return !isSecurityDomain();
  }
  return window.location.hostname === config.appDomain;
}
