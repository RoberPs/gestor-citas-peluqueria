import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';
import { securityHeaders } from '@/infrastructure/security/security-headers';

/**
 * Principio V. On the shared VPS the proxy in front is the chatbot's Caddy,
 * which adds no security header of its own, so every one of them is the
 * application's: HSTS and the CSP included.
 */

function header(mode: 'production' | 'development', key: string): string | undefined {
  return securityHeaders(mode).find((entry) => entry.key === key)?.value;
}

function directives(csp: string | undefined): Map<string, string> {
  return new Map(
    (csp ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((part) => {
        const [name = '', ...values] = part.split(/\s+/);
        return [name, values.join(' ')] as const;
      }),
  );
}

describe('securityHeaders', () => {
  it('sends HSTS for a year, subdomains included, and does not ask for preloading', () => {
    // A subdomain of a shared zone cannot be preloaded: the list takes apex
    // domains only, and it would bind every other subdomain of the zone.
    expect(header('production', 'Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
  });

  it('keeps the headers it already sent', () => {
    expect(header('production', 'X-Content-Type-Options')).toBe('nosniff');
    expect(header('production', 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('production', 'X-Frame-Options')).toBe('DENY');
  });

  it('allows nothing from another origin and cannot be framed', () => {
    const csp = directives(header('production', 'Content-Security-Policy'));

    expect(csp.get('default-src')).toBe("'self'");
    expect(csp.get('script-src')).toBe("'self' 'unsafe-inline'");
    expect(csp.get('style-src')).toBe("'self' 'unsafe-inline'");
    expect(csp.get('img-src')).toBe("'self' data:");
    expect(csp.get('font-src')).toBe("'self'");
    expect(csp.get('connect-src')).toBe("'self'");
    expect(csp.get('form-action')).toBe("'self'");
    expect(csp.get('frame-ancestors')).toBe("'none'");
    expect(csp.get('base-uri')).toBe("'self'");
    expect(csp.get('object-src')).toBe("'none'");
  });

  it("never allows eval in production, and only in development, which Next's refresh needs", () => {
    expect(directives(header('production', 'Content-Security-Policy')).get('script-src')).not.toContain(
      'unsafe-eval',
    );
    expect(directives(header('development', 'Content-Security-Policy')).get('script-src')).toBe(
      "'self' 'unsafe-inline' 'unsafe-eval'",
    );
  });
});

describe('next.config', () => {
  it('sends them on every path', async () => {
    const rules = (await nextConfig.headers?.()) ?? [];

    expect(rules).toHaveLength(1);
    expect(rules[0]?.source).toBe('/:path*');
    expect(rules[0]?.headers.map((entry) => entry.key)).toEqual(
      expect.arrayContaining(['Strict-Transport-Security', 'Content-Security-Policy']),
    );
  });

  it('builds the self-contained server the image runs', () => {
    expect(nextConfig.output).toBe('standalone');
  });
});
