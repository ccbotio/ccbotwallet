import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware for domain-based routing
 *
 * app.ccbot.io:
 * - All routes allowed (Telegram check is client-side)
 * - Redirects /passkey-* to security.ccbot.io
 *
 * security.ccbot.io:
 * - Only /passkey-* routes allowed
 * - Must have valid session parameter
 * - All other routes return 404
 */

const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN || 'app.ccbot.io';
const SECURITY_DOMAIN = process.env.NEXT_PUBLIC_SECURITY_DOMAIN || 'security.ccbot.io';

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || '';
  const pathname = request.nextUrl.pathname;

  // Skip middleware in development
  if (process.env.NODE_ENV === 'development') {
    return NextResponse.next();
  }

  // Handle security.ccbot.io
  if (hostname === SECURITY_DOMAIN || hostname.startsWith(SECURITY_DOMAIN)) {
    // Only allow passkey routes
    if (!pathname.startsWith('/passkey')) {
      // Return custom 404 page for non-passkey routes
      return NextResponse.rewrite(new URL('/passkey-access-denied', request.url));
    }

    // For passkey routes, check for session parameter
    const sessionParam = request.nextUrl.searchParams.get('session');

    if (!sessionParam && pathname !== '/passkey-access-denied') {
      // No session - show access denied
      return NextResponse.rewrite(new URL('/passkey-access-denied', request.url));
    }

    // Valid passkey route with session - allow
    return NextResponse.next();
  }

  // Handle app.ccbot.io
  if (hostname === APP_DOMAIN || hostname.startsWith(APP_DOMAIN)) {
    // Redirect passkey routes to security domain
    if (pathname.startsWith('/passkey-create') || pathname.startsWith('/passkey-auth')) {
      const session = request.nextUrl.searchParams.get('session');
      const securityUrl = new URL(pathname, `https://${SECURITY_DOMAIN}`);
      if (session) {
        securityUrl.searchParams.set('session', session);
      }
      return NextResponse.redirect(securityUrl);
    }

    // All other routes allowed (Telegram check is client-side)
    return NextResponse.next();
  }

  // Unknown domain - allow (for preview URLs, etc.)
  return NextResponse.next();
}

export const config = {
  // Match all routes except static files and API routes
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|ccbotlogo.png|.*\\.png$|.*\\.ico$).*)',
  ],
};
