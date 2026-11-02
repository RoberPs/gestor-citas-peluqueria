import pino, { type DestinationStream, type Logger } from 'pino';

/**
 * Structured logging with the personal fields redacted at the logger, not at
 * each call site (FR-036, Principio III).
 *
 * Relying on every caller to remember is how personal data reaches a log. Here
 * a trace that carries a name simply cannot print it, and traces reference
 * `appointmentId`, which is internal and appears in no client URL.
 */

/** The three personal fields plus the management token, which is a credential. */
const SENSITIVE = ['name', 'phone', 'email', 'token'] as const;

/**
 * Pino matches one level per `*`, so the depths that can actually occur are
 * listed. Three levels covers a field at the top, under `customer` or `err`,
 * and inside a request payload.
 */
const REDACT_PATHS = SENSITIVE.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]);

/**
 * Errors are re-serialised rather than dumped.
 *
 * Pino's default serializer copies every own property of the error and keeps
 * the whole stack, whose first line is `name: message` — so an error carrying a
 * customer name prints it inside `stack`, where field redaction cannot reach.
 * Emitting only the type, the message, a driver code and the call frames closes
 * that path: frames are file paths and carry nothing personal.
 */
function serializeError(error: Error): Record<string, unknown> {
  const frames =
    typeof error.stack === 'string'
      ? error.stack
          .split('\n')
          .filter((line) => /^\s+at\s/.test(line))
          .join('\n')
      : undefined;

  const code = (error as { code?: unknown }).code;

  return {
    type: error.constructor.name,
    message: error.message,
    ...(typeof code === 'string' ? { code } : {}),
    stack: frames,
  };
}

export function createLogger(destination?: DestinationStream): Logger {
  const options = {
    level: process.env['LOG_LEVEL'] ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    serializers: { err: serializeError, error: serializeError },
    base: undefined,
  } as const;

  return destination === undefined ? pino(options) : pino(options, destination);
}

const globalForLogger = globalThis as unknown as { __salonLogger?: Logger };

export function logger(): Logger {
  globalForLogger.__salonLogger ??= createLogger();
  return globalForLogger.__salonLogger;
}
