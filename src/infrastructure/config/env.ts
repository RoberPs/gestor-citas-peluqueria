import { z } from 'zod';

/**
 * Environment validated once, at the boundary, with a message an operator can
 * act on. A missing secret should stop the process, not surface three layers
 * down as `undefined`.
 */

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SALON_TIMEZONE: z.string().min(1).default('Europe/Madrid'),
  RATE_LIMIT_SECRET: z.string().min(1, 'RATE_LIMIT_SECRET is required'),
  TRUSTED_PROXY_IPS: z.string().default(''),
  PUBLIC_BASE_URL: z
    .string()
    .url('PUBLIC_BASE_URL must be an absolute URL, e.g. https://salon.example')
    .default('http://localhost:3000'),
});

export type Env = {
  readonly databaseUrl: string;
  readonly salonTimezone: string;
  readonly rateLimitSecret: string;
  readonly trustedProxyIps: readonly string[];
  /**
   * Base of the **absolute** management link the client is told to save
   * (FR-015). Absolute because the confirmation screen is its only delivery:
   * v1 sends no message, so a relative link the client copies out of the
   * address bar is not good enough.
   */
  readonly publicBaseUrl: string;
};

let cached: Env | undefined;

export function env(): Env {
  if (cached !== undefined) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }

  cached = {
    databaseUrl: parsed.data.DATABASE_URL,
    salonTimezone: parsed.data.SALON_TIMEZONE,
    rateLimitSecret: parsed.data.RATE_LIMIT_SECRET,
    trustedProxyIps: parsed.data.TRUSTED_PROXY_IPS.split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip !== ''),
    publicBaseUrl: parsed.data.PUBLIC_BASE_URL.replace(/\/+$/, ''),
  };

  return cached;
}

/** Test seam: forces the next `env()` to re-read `process.env`. */
export function resetEnvCache(): void {
  cached = undefined;
}

/**
 * The client IP used as the rate-limit key, and nothing else.
 *
 * `X-Forwarded-For` is only believed when the request actually came from a
 * configured proxy. Without that check anyone sets the header and the limit
 * stops existing (D-007).
 *
 * `remoteAddress` is `null` in a Next Route Handler, which does not expose the
 * socket. With proxies configured we then rely on the deployment guarantee
 * documented in quickstart.md: the application listens only on the compose
 * network and is unreachable except through the proxy that sets the header.
 */
export function resolveClientIp(input: {
  readonly forwardedFor: string | null;
  readonly remoteAddress: string | null;
}): string {
  const trusted = env().trustedProxyIps;
  const fromTrustedProxy =
    trusted.length > 0 &&
    (input.remoteAddress === null || trusted.includes(input.remoteAddress));

  if (fromTrustedProxy && input.forwardedFor !== null) {
    const firstHop = input.forwardedFor.split(',')[0]?.trim();
    if (firstHop !== undefined && firstHop !== '') return firstHop;
  }

  return input.remoteAddress ?? 'unknown';
}

/** Builds the absolute management link shown on the confirmation screen (FR-015). */
export function managementLink(token: string): string {
  return `${env().publicBaseUrl}/cita/${token}`;
}
