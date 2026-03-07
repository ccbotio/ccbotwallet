import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware to restrict access to Telegram WebView only.
 *
 * Detection methods:
 * 1. User-Agent contains "Telegram" or "TelegramBot"
 * 2. Referer from Telegram domains
 * 3. tgWebAppData query parameter present
 */
export function middleware(request: NextRequest) {
  const userAgent = request.headers.get('user-agent') || '';
  const referer = request.headers.get('referer') || '';
  const url = request.nextUrl;

  // Check for Telegram indicators
  const isTelegramUA = /telegram/i.test(userAgent);
  const isTelegramReferer = /t\.me|telegram\.org|web\.telegram\.org/i.test(referer);
  const hasTgWebAppData = url.searchParams.has('tgWebAppData') ||
                          url.searchParams.has('tgWebAppStartParam');

  // Allow if any Telegram indicator is present
  const isTelegramAccess = isTelegramUA || isTelegramReferer || hasTgWebAppData;

  // Allow health checks and API routes
  const isHealthCheck = url.pathname === '/health' || url.pathname === '/api/health';
  const isApiRoute = url.pathname.startsWith('/api/');

  // Allow dApp approval page (CIP-103)
  const isDappApprove = url.pathname === '/approve';

  // Allow static assets
  const isStaticAsset = url.pathname.startsWith('/_next/') ||
                        url.pathname.startsWith('/static/') ||
                        url.pathname.includes('.');

  // Development mode bypass
  const isDev = process.env.NODE_ENV === 'development';

  // If not from Telegram and not allowed path, show access denied
  if (!isTelegramAccess && !isHealthCheck && !isApiRoute && !isStaticAsset && !isDappApprove && !isDev) {
    // Redirect to access denied page
    return NextResponse.redirect(new URL('/passkey-access-denied', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
