/**
 * The owner's session cookie (002, D-015).
 *
 * `__Host-` ties it to this exact origin, with no Domain and Path=/, and the
 * browser refuses it without Secure: served over plain HTTP it fails at once
 * and visibly (localhost excepted). HttpOnly keeps it out of reach of any
 * script, SameSite=Strict out of any cross-site request. No Max-Age: the
 * twelve idle hours are enforced on the server, on the row.
 */

export const OWNER_SESSION_COOKIE = '__Host-owner_session';

const ATTRIBUTES = 'Path=/; HttpOnly; Secure; SameSite=Strict';

export function sessionCookie(token: string): string {
  return `${OWNER_SESSION_COOKIE}=${token}; ${ATTRIBUTES}`;
}

/** Expires the cookie in the browser; the row is what really ends the session. */
export function expiredSessionCookie(): string {
  return `${OWNER_SESSION_COOKIE}=; ${ATTRIBUTES}; Max-Age=0`;
}

/** The token from a request's Cookie header, if there is one. */
export function sessionTokenOf(request: Request): string | undefined {
  const header = request.headers.get('cookie');
  if (header === null) return undefined;

  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === OWNER_SESSION_COOKIE) return value.join('=');
  }
  return undefined;
}
