import { NextResponse, type NextRequest } from 'next/server';
import { OWNER_SESSION_COOKIE } from './app/api/gestion/_lib/session-cookie';

/**
 * A convenience, NOT the access boundary (002, D-018).
 *
 * It only spares the owner a blank screen: a request for an owner screen with
 * no session cookie at all goes straight to the sign-in form. It authorises
 * nothing — it does not even check that the cookie is valid. Every screen and
 * every Route Handler checks the session itself, so if this file disappeared,
 * or were bypassed as CVE-2025-29927 bypassed middleware, no response would
 * leak a thing. The API is not matched: a handler answers 401, not a redirect.
 */
export function middleware(request: NextRequest): NextResponse {
  if (request.cookies.has(OWNER_SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL('/gestion/acceso', request.url));
}

export const config = {
  matcher: ['/gestion', '/gestion/((?!acceso).*)'],
};
