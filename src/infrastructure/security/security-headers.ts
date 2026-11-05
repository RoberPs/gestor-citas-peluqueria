/**
 * The security headers of every response (Principio V).
 *
 * They are the application's own, not the proxy's: on the shared VPS the proxy
 * is the chatbot's Caddy, which only strips `Server`. Whoever serves this app
 * gets them with it.
 */

export type HeaderMode = 'production' | 'development';

/**
 * The management link is a credential in a URL, so it must not leak anywhere:
 * no framing, no form posts off-site, no third-party anything.
 *
 * `script-src` allows inline because Next bootstraps its hydration with an
 * inline script; tightening it needs per-request nonces. `'unsafe-eval'` is
 * there only in development, where Next's refresh evaluates code.
 */
function contentSecurityPolicy(mode: HeaderMode): string {
  const scripts = ["'self'", "'unsafe-inline'", ...(mode === 'development' ? ["'unsafe-eval'"] : [])];

  return [
    "default-src 'self'",
    `script-src ${scripts.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function securityHeaders(mode: HeaderMode): { key: string; value: string }[] {
  return [
    // No `preload`: the preload list takes apex domains only, and this app
    // lives on a subdomain of a zone it shares. Browsers ignore HSTS over
    // plain HTTP, so local and e2e runs are unaffected.
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(mode) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
  ];
}
