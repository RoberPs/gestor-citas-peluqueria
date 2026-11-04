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
  // 004, D-005: each channel has its own switch. SMS has no adapter yet.
  NOTIFICATIONS_EMAIL: z.enum(['on', 'off'], { message: 'NOTIFICATIONS_EMAIL must be on or off' }).default('off'),
  NOTIFICATIONS_SMS: z
    .enum(['off'], { message: 'NOTIFICATIONS_SMS only accepts off: there is no SMS adapter yet' })
    .default('off'),
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_API_BASE_URL: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_REPLY_TO: z.string().optional(),
  NOTIFICATION_SEAL_KEY: z.string().optional(),
});

const RESEND_API_BASE_URL = 'https://api.resend.com';

/** What the email channel needs, all of it or none (D-005). */
const emailSchema = z.object({
  EMAIL_API_KEY: z.string({ message: 'EMAIL_API_KEY is required with NOTIFICATIONS_EMAIL=on' }),
  EMAIL_FROM: z
    .string({ message: 'EMAIL_FROM is required with NOTIFICATIONS_EMAIL=on' })
    .email('EMAIL_FROM must be an email address on the verified domain'),
  EMAIL_API_BASE_URL: z
    .string()
    .url('EMAIL_API_BASE_URL must be an absolute URL')
    .optional(),
  NOTIFICATION_SEAL_KEY: z
    .string({ message: 'NOTIFICATION_SEAL_KEY is required with NOTIFICATIONS_EMAIL=on' })
    .refine((value) => Buffer.from(value, 'base64').length === 32, {
      message: 'NOTIFICATION_SEAL_KEY must be 32 random bytes in base64 (openssl rand -base64 32)',
    }),
});

export type EmailChannelConfig = {
  readonly apiKey: string;
  readonly apiBaseUrl: string;
  readonly from: string;
  readonly replyTo: string | null;
  readonly sealKey: string;
};

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
  /** 004: `email` is `null` while the channel is off. */
  readonly notifications: { readonly email: EmailChannelConfig | null };
};

function problemsOf(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

const NOTIFICATION_VARIABLES = /^(NOTIFICATIONS_|EMAIL_|NOTIFICATION_SEAL_KEY$)/;

/**
 * An empty notification variable, as `.env.example` leaves them, counts as
 * missing. The variables before 004 are validated as they always were.
 */
function blankToUndefined(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(source).map(([name, value]) => [
      name,
      value === '' && NOTIFICATION_VARIABLES.test(name) ? undefined : value,
    ]),
  );
}

function emailChannelOf(source: Record<string, string | undefined>): EmailChannelConfig {
  const parsed = emailSchema.safeParse(source);
  if (!parsed.success) throw new Error(`Invalid environment: ${problemsOf(parsed.error)}`);

  return {
    apiKey: parsed.data.EMAIL_API_KEY,
    apiBaseUrl: (parsed.data.EMAIL_API_BASE_URL ?? RESEND_API_BASE_URL).replace(/\/+$/, ''),
    from: parsed.data.EMAIL_FROM,
    replyTo: source['EMAIL_REPLY_TO'] ?? null,
    sealKey: parsed.data.NOTIFICATION_SEAL_KEY,
  };
}

let cached: Env | undefined;

export function env(): Env {
  if (cached !== undefined) return cached;

  const source = blankToUndefined(process.env);
  const parsed = schema.safeParse(source);
  if (!parsed.success) throw new Error(`Invalid environment: ${problemsOf(parsed.error)}`);

  cached = {
    databaseUrl: parsed.data.DATABASE_URL,
    salonTimezone: parsed.data.SALON_TIMEZONE,
    rateLimitSecret: parsed.data.RATE_LIMIT_SECRET,
    trustedProxyIps: parsed.data.TRUSTED_PROXY_IPS.split(',')
      .map((ip) => ip.trim())
      .filter((ip) => ip !== ''),
    publicBaseUrl: parsed.data.PUBLIC_BASE_URL.replace(/\/+$/, ''),
    notifications: {
      email: parsed.data.NOTIFICATIONS_EMAIL === 'on' ? emailChannelOf(source) : null,
    },
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

/** The unsubscribe page an email links to (004, D-009). */
export function unsubscribeLink(token: string): string {
  return `${env().publicBaseUrl}/baja/${token}`;
}

/** The one-click unsubscribe of the `List-Unsubscribe` header (004, RFC 8058). */
export function oneClickUnsubscribeLink(token: string): string {
  return `${env().publicBaseUrl}/api/unsubscribe/${token}`;
}
